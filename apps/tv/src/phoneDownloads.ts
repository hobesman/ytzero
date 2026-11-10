import type { PlaybackPosition } from "./playback";
import type { NativeDownloadStatus, PhoneDownloadsNative } from "./phoneDownloadsNative";
import type { Video } from "./types";

/**
 * Videos saved on an Android phone for offline playback.
 *
 * The server fetches the video first, as for the website's "Download to your
 * device" (a device-only claim the server releases once the file has been sent
 * in full). The phone then downloads that file with Android's DownloadManager
 * into the app's own folder. Everything here is device-only data: the files, the
 * index beside them and the positions waiting to be sent to the server. None of
 * it is part of a server backup; see docs/backup-restore-architecture.md.
 */
export const PHONE_DOWNLOAD_QUALITIES = ["480", "720", "1080", "server"] as const;
export type PhoneDownloadQuality = (typeof PHONE_DOWNLOAD_QUALITIES)[number];
export const DEFAULT_PHONE_DOWNLOAD_QUALITY: PhoneDownloadQuality = "720";

export type PhoneDownloadError = "disabled" | "notAllowed" | "server" | "transfer";
export type PhoneDownload = {
  /** The profile that saved it: see `downloadOwner`. */
  owner: string;
  videoId: string;
  /** The video's details when it was saved, kept current with its watch position. */
  video: Video;
  quality: PhoneDownloadQuality;
  /** "server": the server is still fetching it; "downloading": the phone is. */
  state: "server" | "downloading" | "done" | "failed";
  file: string;
  thumbnail: string | null;
  nativeId: string | null;
  size: number | null;
  downloaded: number | null;
  total: number | null;
  serverPercent: number | null;
  waiting: "wifi" | "network" | null;
  error: PhoneDownloadError | null;
  addedAt: number;
};
/** A position or finished video the server has not heard about yet. */
export type PendingPlayback = { owner: string; videoId: string; position: number; duration: number; completed: boolean; at: number };
export type PhoneDownloadIndex = {
  version: 1;
  downloads: PhoneDownload[];
  pending: PendingPlayback[];
  /** The profile last signed in on this phone, whose downloads play when the server can't be reached. */
  lastOwner: string | null;
  quality: PhoneDownloadQuality;
  /** Off: downloads wait for Wi-Fi (an unmetered network). */
  allowMetered: boolean;
};

type DownloadApi = {
  requestDeviceDownload(id: string, quality?: string): Promise<unknown>;
  videoDownload(id: string): Promise<{ download: { status: string } | null; progress: { percent: number } | null }>;
  savePlaybackProgress(id: string, value: PlaybackPosition): Promise<unknown>;
  markWatched(id: string): Promise<unknown>;
  thumbnailSource(url: string): { uri?: string };
};
export type DownloadConnection = { owner: string; instanceUrl: string; accessToken?: string; api: DownloadApi };
type Timers = { now: () => number; setTimeout: (callback: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void };

const INDEX_FILE = "index.json";
const POLL_MS = 2500;
const emptyIndex = (): PhoneDownloadIndex => ({ version: 1, downloads: [], pending: [], lastOwner: null, quality: DEFAULT_PHONE_DOWNLOAD_QUALITY, allowMetered: false });

/** A profile on a server: downloads and pending positions belong to one. */
export function downloadOwner(instanceUrl: string, profileId: number): string {
  return `${instanceUrl.replace(/\/+$/, "")}#${profileId}`;
}

/** File names are per profile, so two profiles saving one video never share a file. */
export function downloadFileBase(owner: string, videoId: string): string {
  let hash = 5381;
  for (let index = 0; index < owner.length; index++) hash = ((hash * 33) ^ owner.charCodeAt(index)) >>> 0;
  return `${hash.toString(36)}-${videoId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function isQuality(value: unknown): value is PhoneDownloadQuality {
  return typeof value === "string" && (PHONE_DOWNLOAD_QUALITIES as readonly string[]).includes(value);
}

/** Reads the index file, dropping anything malformed instead of failing. */
export function parseDownloadIndex(text: string | null): PhoneDownloadIndex {
  const index = emptyIndex();
  if (!text) return index;
  let value: Partial<PhoneDownloadIndex>;
  try { value = JSON.parse(text); } catch { return index; }
  if (!value || typeof value !== "object" || value.version !== 1) return index;
  const valid = (item: Partial<PhoneDownload>): item is PhoneDownload => typeof item?.owner === "string" && typeof item.videoId === "string"
    && typeof item.file === "string" && !!item.video && typeof item.video === "object" && typeof item.video.video_id === "string"
    && ["server", "downloading", "done", "failed"].includes(item.state as string);
  index.downloads = Array.isArray(value.downloads) ? value.downloads.filter(valid) : [];
  index.pending = Array.isArray(value.pending) ? value.pending.filter((item) => typeof item?.owner === "string" && typeof item.videoId === "string"
    && Number.isFinite(item.position) && Number.isFinite(item.duration)) : [];
  index.lastOwner = typeof value.lastOwner === "string" ? value.lastOwner : null;
  index.quality = isQuality(value.quality) ? value.quality : DEFAULT_PHONE_DOWNLOAD_QUALITY;
  index.allowMetered = value.allowMetered === true;
  return index;
}

/** Whether a video can be saved on the phone at all. */
export function canDownloadToPhone(video: Video): boolean {
  return video.downloads_allowed !== false && video.live_status !== "live" && video.live_status !== "upcoming"
    && video.is_private !== 1 && video.members_only !== 1 && video.external !== 1;
}

export function formatBytes(bytes: number, locale: string): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

/** The share of a download done so far, 0 to 1, or null when unknown. */
export function downloadFraction(item: PhoneDownload): number | null {
  if (item.state === "server") return item.serverPercent == null ? null : Math.max(0, Math.min(1, item.serverPercent / 100));
  if (item.state !== "downloading" || !item.total || item.total <= 0) return null;
  return Math.max(0, Math.min(1, (item.downloaded ?? 0) / item.total));
}

export class PhoneDownloadStore {
  private index = emptyIndex();
  private connection: DownloadConnection | null = null;
  private listeners = new Set<() => void>();
  private writing: Promise<unknown> = Promise.resolve();
  private pollTimer: unknown = null;
  private polling = false;
  private flushing = false;
  private version = 0;
  readonly ready: Promise<void>;

  constructor(private readonly native: PhoneDownloadsNative | null, private readonly timers: Timers = {
    now: () => Date.now(), setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }) {
    this.ready = this.load();
  }

  get available(): boolean { return this.native !== null; }

  private async load() {
    if (!this.native) return;
    try { this.index = parseDownloadIndex(await this.native.readText(INDEX_FILE)); } catch { this.index = emptyIndex(); }
    this.changed(false);
    this.schedulePoll(0);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Changes with every update, for useSyncExternalStore. */
  getVersion = () => this.version;
  snapshot(): PhoneDownloadIndex { return this.index; }

  private changed(persist = true) {
    this.version++;
    this.index = { ...this.index };
    this.listeners.forEach((listener) => listener());
    if (!persist || !this.native) return;
    const text = JSON.stringify(this.index);
    const native = this.native;
    this.writing = this.writing.catch(() => {}).then(() => native.writeText(INDEX_FILE, text));
  }

  /** Waits for the index to reach the disk (tests and shutdown). */
  async settled() { await this.writing.catch(() => {}); }

  /** The profile whose downloads are shown: the signed-in one, or the last one when offline. */
  get owner(): string | null { return this.connection?.owner ?? this.index.lastOwner; }

  /** Called when a profile is signed in (or with null when signing out). Sends positions saved offline. */
  async connect(connection: DownloadConnection | null) {
    await this.ready;
    this.connection = connection;
    if (connection && this.index.lastOwner !== connection.owner) {
      this.index.lastOwner = connection.owner;
      this.changed();
    } else this.changed(false);
    if (connection) void this.flushPending();
    this.schedulePoll(0);
  }

  downloads(owner = this.owner): PhoneDownload[] {
    return owner ? this.index.downloads.filter((item) => item.owner === owner).sort((a, b) => b.addedAt - a.addedAt) : [];
  }

  find(videoId: string, owner = this.owner): PhoneDownload | null {
    return owner ? this.index.downloads.find((item) => item.owner === owner && item.videoId === videoId) ?? null : null;
  }

  private fileUri(name: string): string { return `${this.native!.directoryUri().replace(/\/+$/, "")}/${name}`; }

  /** The saved file of a finished download, for the player. */
  localUri(videoId: string): string | null {
    const item = this.find(videoId);
    return item?.state === "done" && this.native ? this.fileUri(item.file) : null;
  }

  /** A saved thumbnail for an image URL, so downloaded videos keep their pictures offline. */
  localThumbnail(url: string): string | null {
    if (!url || !this.native) return null;
    const item = this.downloads().find((entry) => entry.thumbnail && entry.video.thumbnail === url);
    return item?.thumbnail ? this.fileUri(item.thumbnail) : null;
  }

  private update(item: PhoneDownload, patch: Partial<PhoneDownload>) {
    // Match by identity of the download, not the object: polling holds older copies.
    this.index.downloads = this.index.downloads.map((entry) => entry.owner === item.owner && entry.videoId === item.videoId ? { ...entry, ...patch } : entry);
    this.changed();
  }

  async download(video: Video) {
    await this.ready;
    const connection = this.connection;
    if (!this.native || !connection) return;
    const existing = this.find(video.video_id, connection.owner);
    if (existing && existing.state !== "failed") return;
    if (existing) await this.discard(existing);
    const base = downloadFileBase(connection.owner, video.video_id);
    const item: PhoneDownload = {
      owner: connection.owner, videoId: video.video_id, video, quality: this.index.quality, state: "server",
      file: `${base}.mp4`, thumbnail: null, nativeId: null, size: null, downloaded: null, total: null,
      serverPercent: null, waiting: null, error: null, addedAt: this.timers.now(),
    };
    this.index.downloads = [...this.index.downloads, item];
    this.changed();
    void this.saveThumbnail(connection, video, `${base}.jpg`);
    try {
      await connection.api.requestDeviceDownload(video.video_id, item.quality === "server" ? undefined : item.quality);
    } catch (error) {
      const status = (error as { status?: number })?.status;
      const current = this.find(video.video_id, connection.owner);
      if (current) this.update(current, { state: "failed", error: status === 409 ? "disabled" : status === 403 ? "notAllowed" : "server" });
      return;
    }
    this.schedulePoll(0);
  }

  private async saveThumbnail(connection: DownloadConnection, video: Video, name: string) {
    const uri = video.thumbnail ? connection.api.thumbnailSource(video.thumbnail).uri : null;
    if (!uri || !this.native) return;
    const size = await this.native.fetchFile(uri, this.headers(connection), name).catch(() => -1);
    const current = this.find(video.video_id, connection.owner);
    if (size > 0 && current) this.update(current, { thumbnail: name });
    else if (size > 0) await this.native.deleteFile(name).catch(() => {});
  }

  private headers(connection: DownloadConnection): Record<string, string> {
    return connection.accessToken ? { Authorization: `Bearer ${connection.accessToken}` } : {};
  }

  private async discard(item: PhoneDownload) {
    this.index.downloads = this.index.downloads.filter((entry) => entry !== item);
    this.changed();
    if (!this.native) return;
    if (item.nativeId) await this.native.cancel(item.nativeId).catch(() => {});
    await this.native.deleteFile(item.file).catch(() => {});
    if (item.thumbnail) await this.native.deleteFile(item.thumbnail).catch(() => {});
  }

  async remove(videoId: string) {
    await this.ready;
    const item = this.find(videoId);
    if (item) await this.discard(item);
  }

  async removeAll() {
    await this.ready;
    for (const item of this.downloads()) await this.discard(item);
  }

  async retry(videoId: string) {
    const item = this.find(videoId);
    if (item?.state === "failed") await this.download(item.video);
  }

  setQuality(quality: PhoneDownloadQuality) { this.index.quality = quality; this.changed(); }
  setAllowMetered(value: boolean) { this.index.allowMetered = value; this.changed(); }

  /** Bytes used by this profile's finished downloads. */
  usedBytes(owner = this.owner): number {
    return this.downloads(owner).reduce((total, item) => total + (item.state === "done" ? item.size ?? 0 : 0), 0);
  }

  async freeBytes(): Promise<number | null> {
    return this.native ? await this.native.freeBytes().catch(() => null) : null;
  }

  /**
   * Keeps a downloaded video's position on the phone, for resuming offline, and
   * remembers it for the server when sending it failed.
   */
  recordPlayback(videoId: string, value: PlaybackPosition, completed: boolean, unsent: boolean) {
    const owner = this.owner;
    const item = owner ? this.find(videoId, owner) : null;
    if (!owner || !item) return;
    // markWatched carries no position (duration 0): keep the last one.
    const known = value.duration > 0;
    this.index.downloads = this.index.downloads.map((entry) => entry === item ? { ...entry, video: {
      ...entry.video, watch_position: known ? value.position : entry.video.watch_position, watch_duration: known ? value.duration : entry.video.watch_duration,
      watched: completed ? 1 : entry.video.watched,
    } } : entry);
    if (unsent) {
      const previous = this.index.pending.find((entry) => entry.owner === owner && entry.videoId === videoId);
      const next: PendingPlayback = {
        owner, videoId, position: known ? value.position : previous?.position ?? 0, duration: known ? value.duration : previous?.duration ?? 0,
        completed: completed || (previous?.completed ?? false), at: this.timers.now(),
      };
      this.index.pending = [...this.index.pending.filter((entry) => entry !== previous), next];
    }
    this.changed();
  }

  /** Sends the positions saved while offline; each one leaves the list once the server has it. */
  async flushPending() {
    const connection = this.connection;
    if (!connection || this.flushing) return;
    this.flushing = true;
    try {
      for (const entry of this.index.pending.filter((item) => item.owner === connection.owner)) {
        try {
          if (entry.duration > 0) await connection.api.savePlaybackProgress(entry.videoId, { position: entry.position, duration: entry.duration });
          if (entry.completed) await connection.api.markWatched(entry.videoId);
        } catch { break; }
        this.index.pending = this.index.pending.filter((item) => item !== entry);
        this.changed();
      }
    } finally { this.flushing = false; }
  }

  private schedulePoll(ms = POLL_MS) {
    if (!this.native) return;
    if (this.pollTimer !== null) this.timers.clearTimeout(this.pollTimer);
    this.pollTimer = this.timers.setTimeout(() => { this.pollTimer = null; void this.poll(); }, ms);
  }

  /** Moves active downloads along; keeps polling while any is unfinished. */
  async poll() {
    if (!this.native || this.polling) return;
    this.polling = true;
    try {
      const connection = this.connection;
      for (const item of this.index.downloads.filter((entry) => entry.state === "server" && entry.owner === connection?.owner)) {
        await this.pollServer(connection!, item);
      }
      const active = this.index.downloads.filter((entry) => entry.state === "downloading" && entry.nativeId);
      if (active.length) {
        const statuses = await this.native.query(active.map((entry) => entry.nativeId!)).catch(() => null);
        if (statuses) for (const item of active) {
          const status = statuses.find((entry) => entry.id === item.nativeId);
          if (status) await this.pollNative(item, status);
        }
      }
    } finally {
      this.polling = false;
    }
    const waiting = this.index.downloads.some((entry) => entry.state === "downloading" || (entry.state === "server" && entry.owner === this.connection?.owner));
    if (waiting) this.schedulePoll();
  }

  private async pollServer(connection: DownloadConnection, item: PhoneDownload) {
    let result: Awaited<ReturnType<DownloadApi["videoDownload"]>>;
    // Unreachable for now: try again on the next round.
    try { result = await connection.api.videoDownload(item.videoId); } catch { return; }
    const current = this.find(item.videoId, item.owner);
    if (!current || current.state !== "server") return;
    const status = result.download?.status;
    if (status === "done") {
      const url = `${connection.instanceUrl.replace(/\/+$/, "")}/api/videos/${encodeURIComponent(item.videoId)}/file`;
      try {
        const nativeId = await this.native!.enqueue(url, this.headers(connection), current.file, current.video.title, this.index.allowMetered);
        this.update(current, { state: "downloading", nativeId, serverPercent: null });
      } catch {
        this.update(current, { state: "failed", error: "transfer" });
      }
    } else if (status === "error" || !result.download) {
      this.update(current, { state: "failed", error: "server" });
    } else {
      const percent = result.progress?.percent ?? null;
      if (percent !== current.serverPercent) this.update(current, { serverPercent: percent });
    }
  }

  private async pollNative(item: PhoneDownload, status: NativeDownloadStatus) {
    if (status.status === "done") {
      const size = await this.native!.finish(item.nativeId!, item.file).catch(() => -1);
      const current = this.find(item.videoId, item.owner);
      if (!current) return;
      this.update(current, size > 0 ? { state: "done", size, nativeId: null, waiting: null, downloaded: size, total: size } : { state: "failed", error: "transfer", nativeId: null });
    } else if (status.status === "failed" || status.status === "missing") {
      await this.native!.deleteFile(item.file).catch(() => {});
      this.update(item, { state: "failed", error: "transfer", nativeId: null });
    } else {
      const patch = { downloaded: status.downloaded ?? null, total: status.total && status.total > 0 ? status.total : null, waiting: status.waiting ?? null };
      if (patch.downloaded !== item.downloaded || patch.total !== item.total || patch.waiting !== item.waiting) this.update(item, patch);
    }
  }
}
