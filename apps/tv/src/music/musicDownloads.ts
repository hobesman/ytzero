import type { PhoneDownloadsNative } from "../phoneDownloadsNative";
import type { MusicAlbum, MusicAlbumPage, MusicApi, MusicPlay, MusicPlaylistPage, MusicTrack, MusicUserPlaylistPage } from "./musicApi";

/**
 * Songs, albums and playlists saved on an Android phone for offline listening.
 *
 * The phone fetches each song from the server's `/music/tracks/:id/audio`, a
 * range at a time (the server answers in bounded ranges), into the app's own
 * downloads folder, the one downloaded videos use. Files are named per profile,
 * and every screen reads only the signed-in profile's entries, so another
 * profile never sees them. Albums and playlists keep their track list, and the
 * next time the server can be reached they are brought up to date. Listens
 * played with no connection wait here until the server can take them.
 *
 * All of it is device-only data, never part of a server backup; see
 * docs/backup-restore-architecture.md.
 */
export type MusicDownloadState = "queued" | "downloading" | "done" | "failed";
export type MusicDownloadError = "server" | "transfer";

export type MusicDownloadTrack = {
  /** The profile that saved it: `downloadOwner(instanceUrl, profileId)`. */
  owner: string;
  videoId: string;
  track: MusicTrack;
  state: MusicDownloadState;
  file: string;
  /** The saved artwork file, when the song has artwork. */
  artwork: string | null;
  downloaded: number;
  total: number | null;
  size: number | null;
  error: MusicDownloadError | null;
  /** Saved on its own, not only as part of an album or playlist. */
  single: boolean;
  addedAt: number;
};

/** "mine": one of the profile's own playlists; "playlist": a YouTube Music one. */
export type MusicCollectionKind = "album" | "playlist" | "mine";
export type MusicDownloadCollection = {
  owner: string;
  kind: MusicCollectionKind;
  id: string;
  title: string;
  /** An album's artist, or a playlist's subtitle. */
  subtitle: string;
  thumbnail: string | null;
  artwork: string | null;
  /** The album's details, so its page shows offline. */
  album: MusicAlbum | null;
  trackIds: string[];
  addedAt: number;
  syncedAt: number | null;
};

export type PendingMusicPlay = { owner: string; play: MusicPlay };

export type MusicDownloadIndex = {
  version: 1;
  tracks: MusicDownloadTrack[];
  collections: MusicDownloadCollection[];
  /** Listens played while the server couldn't be reached. Never added in Incognito mode. */
  pendingPlays: PendingMusicPlay[];
  /** The profile last signed in on this phone, whose music plays when the server can't be reached. */
  lastOwner: string | null;
  /** Downloads wait for an unmetered network. */
  wifiOnly: boolean;
};

/** What a download is waiting for right now; not kept on disk. */
export type MusicDownloadWaiting = "wifi" | "network" | null;

type DownloadApi = Pick<MusicApi, "album" | "playlist" | "myPlaylist" | "recordPlay" | "audioUrl" | "artworkSource">;

type CollectionPage = { title: string; subtitle: string; thumbnail: string | null; album: MusicAlbum | null; tracks: MusicTrack[] };

function collectionPage(kind: MusicCollectionKind, page: MusicAlbumPage | MusicPlaylistPage | MusicUserPlaylistPage): CollectionPage {
  if (kind === "album" && "browseId" in page) {
    const { tracks, saved: _saved, ...album } = page;
    return { title: album.title, subtitle: album.artist, thumbnail: album.thumbnail, album, tracks };
  }
  if ("playlistId" in page) return { title: page.title, subtitle: page.subtitle, thumbnail: page.thumbnail, album: null, tracks: page.tracks };
  // The profile's own playlists show their first song's artwork.
  const mine = page as MusicUserPlaylistPage;
  return { title: mine.title, subtitle: "", thumbnail: mine.tracks[0]?.thumbnail || mine.thumbnail || null, album: null, tracks: mine.tracks };
}

function fetchCollection(api: DownloadApi, kind: MusicCollectionKind, id: string): Promise<MusicAlbumPage | MusicPlaylistPage | MusicUserPlaylistPage> {
  return kind === "album" ? api.album(id) : kind === "playlist" ? api.playlist(id) : api.myPlaylist(id);
}
export type MusicDownloadConnection = { owner: string; accessToken?: string; api: DownloadApi };
type Timers = { now: () => number; setTimeout: (callback: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void };

const INDEX_FILE = "music-index.json";
/** Each request for a song's audio; the server streams it to the phone in one go. */
export const MUSIC_DOWNLOAD_PIECE_BYTES = 2 * 1024 * 1024;
const RETRY_MS = 20_000;
const PENDING_PLAY_LIMIT = 2000;

const emptyIndex = (): MusicDownloadIndex => ({ version: 1, tracks: [], collections: [], pendingPlays: [], lastOwner: null, wifiOnly: false });

function hash36(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index++) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  return hash.toString(36);
}
const safe = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "_");

/** File names are per profile, so two profiles saving one song never share a file. */
export function musicAudioFile(owner: string, videoId: string): string { return `m${hash36(owner)}-${safe(videoId)}.audio`; }
export function musicArtworkFile(owner: string, url: string): string { return `m${hash36(owner)}-a${hash36(url)}.jpg`; }

const isTrack = (value: any): value is MusicTrack => !!value && typeof value === "object" && typeof value.videoId === "string" && typeof value.title === "string";

/** Reads the index file, dropping anything malformed instead of failing. */
export function parseMusicDownloadIndex(text: string | null): MusicDownloadIndex {
  const index = emptyIndex();
  if (!text) return index;
  let value: any;
  try { value = JSON.parse(text); } catch { return index; }
  if (!value || typeof value !== "object" || value.version !== 1) return index;
  index.tracks = Array.isArray(value.tracks) ? value.tracks.filter((item: any) => typeof item?.owner === "string" && typeof item.videoId === "string"
    && typeof item.file === "string" && isTrack(item.track) && ["queued", "downloading", "done", "failed"].includes(item.state))
    .map((item: MusicDownloadTrack) => ({ ...item, downloaded: Number.isFinite(item.downloaded) ? item.downloaded : 0, single: item.single === true })) : [];
  index.collections = Array.isArray(value.collections) ? value.collections.filter((item: any) => typeof item?.owner === "string"
    && ["album", "playlist", "mine"].includes(item.kind) && typeof item.id === "string" && Array.isArray(item.trackIds)) : [];
  index.pendingPlays = Array.isArray(value.pendingPlays) ? value.pendingPlays.filter((item: any) => typeof item?.owner === "string"
    && typeof item.play?.videoId === "string" && typeof item.play.startedAt === "string") : [];
  index.lastOwner = typeof value.lastOwner === "string" ? value.lastOwner : null;
  index.wifiOnly = value.wifiOnly === true;
  return index;
}

/**
 * What the screens read, replaced after every change so components see each
 * one. Read it with the `music…` helpers below.
 */
export type MusicDownloadsView = {
  index: MusicDownloadIndex; owner: string | null; available: boolean; waiting: MusicDownloadWaiting;
  /** The last music request didn't reach the server, so the screens show the downloads. */
  offline: boolean;
};

export function musicDownloadedTracks(view: MusicDownloadsView): MusicDownloadTrack[] {
  return view.owner ? view.index.tracks.filter((item) => item.owner === view.owner) : [];
}

export function musicDownloadTrack(view: MusicDownloadsView, videoId: string): MusicDownloadTrack | null {
  return view.owner ? view.index.tracks.find((item) => item.owner === view.owner && item.videoId === videoId) ?? null : null;
}

export function musicDownloadCollections(view: MusicDownloadsView): MusicDownloadCollection[] {
  return view.owner ? view.index.collections.filter((item) => item.owner === view.owner).sort((a, b) => b.addedAt - a.addedAt) : [];
}

export function musicDownloadCollection(view: MusicDownloadsView, kind: MusicCollectionKind, id: string): MusicDownloadCollection | null {
  return view.owner ? view.index.collections.find((item) => item.owner === view.owner && item.kind === kind && item.id === id) ?? null : null;
}

/** Songs saved on their own, newest first. */
export function musicDownloadedSingles(view: MusicDownloadsView): MusicDownloadTrack[] {
  return musicDownloadedTracks(view).filter((item) => item.single).sort((a, b) => b.addedAt - a.addedAt);
}

/** A song, album or playlist's download, as the Download buttons show it. */
export type MusicDownloadProgress = { state: "none" | "active" | "done" | "failed"; fraction: number | null; done: number; count: number };

export function musicTrackProgress(item: MusicDownloadTrack | null): MusicDownloadProgress {
  if (!item) return { state: "none", fraction: null, done: 0, count: 1 };
  if (item.state === "done") return { state: "done", fraction: 1, done: 1, count: 1 };
  if (item.state === "failed") return { state: "failed", fraction: null, done: 0, count: 1 };
  return { state: "active", fraction: item.total ? Math.max(0, Math.min(1, item.downloaded / item.total)) : null, done: 0, count: 1 };
}

export function musicCollectionProgress(view: MusicDownloadsView, collection: MusicDownloadCollection | null): MusicDownloadProgress {
  if (!collection) return { state: "none", fraction: null, done: 0, count: 0 };
  const items = collection.trackIds.map((id) => musicDownloadTrack(view, id)).filter((item): item is MusicDownloadTrack => item !== null);
  const done = items.filter((item) => item.state === "done").length;
  const active = items.some((item) => item.state === "queued" || item.state === "downloading");
  const count = collection.trackIds.length;
  return { state: active ? "active" : done >= count ? "done" : "failed", fraction: count ? done / count : 1, done, count };
}

/** Bytes used by the shown profile's finished songs, artwork aside. */
export function musicDownloadBytes(view: MusicDownloadsView): number {
  return musicDownloadedTracks(view).reduce((total, item) => total + (item.state === "done" ? item.size ?? 0 : 0), 0);
}

export class MusicDownloadStore {
  private index = emptyIndex();
  private connection: MusicDownloadConnection | null = null;
  private listeners = new Set<() => void>();
  private writing: Promise<unknown> = Promise.resolve();
  private retryTimer: unknown = null;
  private pumping = false;
  private flushing = false;
  private syncing = false;
  private waiting: MusicDownloadWaiting = null;
  private offline = false;
  private currentView: MusicDownloadsView;
  readonly ready: Promise<void>;

  constructor(private readonly native: PhoneDownloadsNative | null, private readonly timers: Timers = {
    now: () => Date.now(), setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }) {
    this.currentView = { index: this.index, owner: null, available: native !== null, waiting: null, offline: false };
    this.ready = this.load();
  }

  get available(): boolean { return this.native !== null; }

  private async load() {
    if (!this.native) return;
    try { this.index = parseMusicDownloadIndex(await this.native.readText(INDEX_FILE)); } catch { this.index = emptyIndex(); }
    this.changed(false);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** An immutable view for the screens, replaced with every update. */
  view = () => this.currentView;

  private changed(persist = true) {
    this.index = { ...this.index };
    this.currentView = { index: this.index, owner: this.owner, available: this.available, waiting: this.waiting, offline: this.offline };
    this.listeners.forEach((listener) => listener());
    if (!persist || !this.native) return;
    const text = JSON.stringify(this.index);
    const native = this.native;
    this.writing = this.writing.catch(() => {}).then(() => native.writeText(INDEX_FILE, text));
  }

  /** Waits for the index to reach the disk (tests). */
  async settled() { await this.writing.catch(() => {}); }

  /** The profile whose music is shown: the signed-in one, or the last one while the server can't be reached. */
  get owner(): string | null { return this.connection?.owner ?? this.index.lastOwner; }

  /**
   * Called when a profile is signed in (null while none is). Sends listens
   * played offline, brings downloaded albums and playlists up to date and
   * resumes unfinished downloads.
   */
  async connect(connection: MusicDownloadConnection | null) {
    await this.ready;
    this.connection = connection;
    if (connection && this.index.lastOwner !== connection.owner) {
      this.index.lastOwner = connection.owner;
      this.changed();
    } else this.changed(false);
    if (!connection) return;
    void this.flushPlays();
    void this.syncCollections();
    void this.pump();
  }

  /** Signing out: this phone no longer shows that profile's music while offline. */
  async signedOut() {
    await this.ready;
    this.connection = null;
    this.index.lastOwner = null;
    this.changed();
  }

  private view_(owner = this.owner): MusicDownloadsView { return { index: this.index, owner, available: this.available, waiting: this.waiting, offline: this.offline }; }

  /** Whether music requests reach the server; back online, waiting downloads and listens go ahead. */
  setReachable(reachable: boolean) {
    if (this.offline === !reachable) return;
    this.offline = !reachable;
    this.changed(false);
    if (reachable) { void this.flushPlays(); void this.pump(); }
  }
  find(videoId: string, owner = this.owner): MusicDownloadTrack | null { return musicDownloadTrack(this.view_(owner), videoId); }
  collection(kind: MusicCollectionKind, id: string, owner = this.owner): MusicDownloadCollection | null { return musicDownloadCollection(this.view_(owner), kind, id); }
  collections(owner = this.owner): MusicDownloadCollection[] { return musicDownloadCollections(this.view_(owner)); }
  tracks(owner = this.owner): MusicDownloadTrack[] { return musicDownloadedTracks(this.view_(owner)); }
  /** The finished songs, as playable tracks. */
  playable(owner = this.owner): MusicTrack[] { return this.tracks(owner).filter((item) => item.state === "done").map((item) => item.track); }

  private fileUri(name: string): string { return `${this.native!.directoryUri().replace(/\/+$/, "")}/${name}`; }

  /** A finished song's file, for the player. */
  localAudio(videoId: string): string | null {
    const item = this.find(videoId);
    return item?.state === "done" && this.native ? this.fileUri(item.file) : null;
  }

  /** The saved artwork for an image address, so downloaded music keeps its pictures offline. */
  localArtwork(url: string | null | undefined): string | null {
    if (!url || !this.native || !this.owner) return null;
    const name = musicArtworkFile(this.owner, url);
    const saved = this.index.tracks.some((item) => item.owner === this.owner && item.artwork === name)
      || this.index.collections.some((item) => item.owner === this.owner && item.artwork === name);
    return saved ? this.fileUri(name) : null;
  }

  private headers(connection: MusicDownloadConnection): Record<string, string> {
    return connection.accessToken ? { Authorization: `Bearer ${connection.accessToken}` } : {};
  }

  /** Adds songs to the queue (or marks them as saved on their own); returns whether any is new. */
  private addTracks(connection: MusicDownloadConnection, tracks: readonly MusicTrack[], single: boolean): boolean {
    let added = false;
    const now = this.timers.now();
    const next = [...this.index.tracks];
    tracks.forEach((track, offset) => {
      const position = next.findIndex((item) => item.owner === connection.owner && item.videoId === track.videoId);
      const item = next[position];
      if (item) {
        const retry = item.state === "failed";
        next[position] = { ...item, track: { ...item.track, ...track }, single: item.single || single,
          ...(retry ? { state: "queued", error: null, downloaded: 0, total: null } : {}) };
        added ||= retry;
        return;
      }
      added = true;
      next.push({
        owner: connection.owner, videoId: track.videoId, track, state: "queued", file: musicAudioFile(connection.owner, track.videoId),
        artwork: null, downloaded: 0, total: null, size: null, error: null, single, addedAt: now + offset,
      });
    });
    this.index.tracks = next;
    return added;
  }

  async downloadTrack(track: MusicTrack) {
    await this.ready;
    const connection = this.connection;
    if (!this.native || !connection) return;
    this.addTracks(connection, [track], true);
    this.changed();
    void this.saveArtwork(connection, [track.thumbnail]);
    void this.pump();
  }

  async downloadAlbum(page: MusicAlbumPage) { await this.saveCollection("album", page.browseId, collectionPage("album", page)); }
  async downloadPlaylist(page: MusicPlaylistPage) { await this.saveCollection("playlist", page.playlistId, collectionPage("playlist", page)); }
  /** One of the profile's own playlists. */
  async downloadMyPlaylist(page: MusicUserPlaylistPage) { await this.saveCollection("mine", page.id, collectionPage("mine", page)); }

  private async saveCollection(kind: MusicCollectionKind, id: string, page: CollectionPage) {
    await this.ready;
    const connection = this.connection;
    if (!this.native || !connection) return;
    const now = this.timers.now();
    const existing = this.collection(kind, id, connection.owner);
    const entry: MusicDownloadCollection = {
      owner: connection.owner, kind, id, title: page.title, subtitle: page.subtitle, thumbnail: page.thumbnail, album: page.album,
      trackIds: unique(page.tracks.map((track) => track.videoId)), artwork: existing?.artwork ?? null, addedAt: existing?.addedAt ?? now, syncedAt: now,
    };
    await this.prune(() => {
      this.index.collections = [...this.index.collections.filter((item) => item !== existing), entry];
      this.addTracks(connection, page.tracks, false);
    }, connection.owner);
    void this.saveArtwork(connection, [page.thumbnail, ...page.tracks.map((track) => track.thumbnail)]);
    void this.pump();
  }

  /**
   * A saved album or playlist's page just loaded from the server (or the
   * profile just changed one of its playlists): the download follows it, so
   * songs added are fetched and songs removed are deleted.
   */
  async refresh(kind: MusicCollectionKind, page: MusicAlbumPage | MusicPlaylistPage | MusicUserPlaylistPage) {
    await this.ready;
    const connection = this.connection;
    const id = "browseId" in page ? page.browseId : "playlistId" in page ? page.playlistId : page.id;
    const current = connection ? this.collection(kind, id, connection.owner) : null;
    if (!connection || !current) return;
    const next = collectionPage(kind, page);
    const trackIds = unique(next.tracks.map((track) => track.videoId));
    const same = current.title === next.title && current.thumbnail === next.thumbnail && trackIds.join() === current.trackIds.join()
      && next.tracks.every((track) => this.find(track.videoId, connection.owner) !== null);
    if (same) return;
    await this.prune(() => {
      this.index.collections = this.index.collections.map((item) => item === current
        ? { ...current, title: next.title, subtitle: next.subtitle, thumbnail: next.thumbnail, album: next.album ?? current.album, trackIds, syncedAt: this.timers.now() } : item);
      this.addTracks(connection, next.tracks, false);
    }, connection.owner);
    void this.saveArtwork(connection, [next.thumbnail, ...next.tracks.map((track) => track.thumbnail)]);
    void this.pump();
  }

  /** Re-fetches one saved album or playlist, such as one of the profile's playlists after an edit. */
  async syncCollection(kind: MusicCollectionKind, id: string) {
    const connection = this.connection;
    if (!connection || !this.collection(kind, id, connection.owner)) return;
    const page = await fetchCollection(connection.api, kind, id).catch(() => null);
    if (page && this.connection === connection) await this.refresh(kind, page);
  }

  /** Fetches each artwork address once per profile; songs and collections share them. */
  private async saveArtwork(connection: MusicDownloadConnection, urls: readonly (string | null)[]) {
    if (!this.native) return;
    for (const url of unique(urls.filter((value): value is string => Boolean(value)))) {
      const name = musicArtworkFile(connection.owner, url);
      const users = () => [
        ...this.index.tracks.filter((item) => item.owner === connection.owner && item.track.thumbnail === url),
        ...this.index.collections.filter((item) => item.owner === connection.owner && item.thumbnail === url),
      ];
      const pending = users();
      if (!pending.length || pending.every((item) => item.artwork === name)) continue;
      let size = pending.some((item) => item.artwork === name) ? 1 : -1;
      if (size < 0) {
        const source = connection.api.artworkSource(url);
        if (!source) continue;
        size = await this.native.fetchFile(source.uri, source.headers ?? this.headers(connection), name).catch(() => -1);
      }
      if (size <= 0) continue;
      if (!users().length) { await this.native.deleteFile(name).catch(() => {}); continue; }
      this.index.tracks = this.index.tracks.map((item) => item.owner === connection.owner && item.track.thumbnail === url ? { ...item, artwork: name } : item);
      this.index.collections = this.index.collections.map((item) => item.owner === connection.owner && item.thumbnail === url ? { ...item, artwork: name } : item);
      this.changed();
    }
  }

  /** Removes a song saved on its own; one that is part of a saved album or playlist stays for that. */
  async removeTrack(videoId: string) {
    await this.prune((owner) => {
      this.index.tracks = this.index.tracks.map((item) => item.owner === owner && item.videoId === videoId ? { ...item, single: false } : item);
    });
  }

  async removeCollection(kind: MusicCollectionKind, id: string) {
    await this.prune((owner) => {
      this.index.collections = this.index.collections.filter((item) => !(item.owner === owner && item.kind === kind && item.id === id));
    });
  }

  /** Removes all of the shown profile's music. */
  async removeAll() {
    await this.prune((owner) => {
      this.index.collections = this.index.collections.filter((item) => item.owner !== owner);
      this.index.tracks = this.index.tracks.map((item) => item.owner === owner ? { ...item, single: false } : item);
    });
  }

  private filesInUse(): Set<string> {
    return new Set([
      ...this.index.tracks.flatMap((item) => [item.file, item.artwork]),
      ...this.index.collections.map((item) => item.artwork),
    ].filter((name): name is string => Boolean(name)));
  }

  /**
   * Applies a change to the shown profile's music, then forgets songs no
   * longer saved on their own or in a collection, and deletes the files
   * nothing uses any more.
   */
  private async prune(change: (owner: string) => void, owner = this.owner) {
    await this.ready;
    if (!owner) return;
    const before = this.filesInUse();
    change(owner);
    const kept = new Set(this.index.collections.filter((item) => item.owner === owner).flatMap((item) => item.trackIds));
    this.index.tracks = this.index.tracks.filter((item) => item.owner !== owner || item.single || kept.has(item.videoId));
    this.changed();
    if (!this.native) return;
    const after = this.filesInUse();
    for (const name of before) if (!after.has(name)) await this.native.deleteFile(name).catch(() => {});
  }

  setWifiOnly(value: boolean) {
    this.index.wifiOnly = value;
    this.changed();
    void this.pump();
  }

  /** Brings saved albums and playlists up to date: new songs are fetched, removed ones deleted. */
  async syncCollections() {
    const connection = this.connection;
    if (!connection || this.syncing) return;
    this.syncing = true;
    try {
      for (const entry of this.collections(connection.owner)) {
        let page: Awaited<ReturnType<typeof fetchCollection>>;
        try { page = await fetchCollection(connection.api, entry.kind, entry.id); }
        catch (error) {
          // Unreachable: try again next time. Gone (a deleted playlist): keep what is saved.
          if (!(error as { status?: number })?.status) return;
          continue;
        }
        if (this.connection !== connection) return;
        await this.refresh(entry.kind, page);
      }
    } finally { this.syncing = false; }
    void this.pump();
  }

  private setWaiting(value: MusicDownloadWaiting) {
    if (this.waiting === value) return;
    this.waiting = value;
    this.changed(false);
  }

  private retryLater() {
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = this.timers.setTimeout(() => { this.retryTimer = null; void this.pump(); }, RETRY_MS);
  }

  /** Fetches queued songs one after another while a profile is signed in. */
  async pump() {
    await this.ready;
    if (!this.native || this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const connection = this.connection;
        if (!connection) break;
        const next = this.index.tracks.filter((item) => item.owner === connection.owner && (item.state === "queued" || item.state === "downloading"))
          .sort((a, b) => (a.state === "downloading" ? -1 : 0) - (b.state === "downloading" ? -1 : 0) || a.addedAt - b.addedAt)[0];
        if (!next) { this.setWaiting(null); break; }
        if (this.index.wifiOnly && this.native.isMetered()) { this.setWaiting("wifi"); this.retryLater(); break; }
        const result = await this.fetchTrack(connection, next);
        if (result === "network") { this.setWaiting("network"); this.retryLater(); break; }
        this.setWaiting(null);
      }
    } finally { this.pumping = false; }
  }

  private patch(item: MusicDownloadTrack, patch: Partial<MusicDownloadTrack>, persist = true) {
    this.index.tracks = this.index.tracks.map((entry) => entry.owner === item.owner && entry.videoId === item.videoId ? { ...entry, ...patch } : entry);
    this.changed(persist);
  }

  private async fetchTrack(connection: MusicDownloadConnection, item: MusicDownloadTrack): Promise<"done" | "failed" | "network" | "gone"> {
    const native = this.native!;
    const url = connection.api.audioUrl(item.videoId);
    let start = item.state === "downloading" ? item.downloaded : 0;
    let total = item.total;
    if (item.state !== "downloading") this.patch(item, { state: "downloading", downloaded: 0, total: null });
    for (;;) {
      if (this.index.wifiOnly && native.isMetered()) return "network";
      const result = await native.fetchRange(url, this.headers(connection), item.file, start, start + MUSIC_DOWNLOAD_PIECE_BYTES - 1)
        .catch(() => ({ status: -1, size: start, total: -1 }));
      const current = this.find(item.videoId, item.owner);
      if (!current || current.state !== "downloading") {
        await native.deleteFile(item.file).catch(() => {});
        return "gone";
      }
      if (result.status === 416 && start > 0) {
        // The partial file doesn't match what was recorded: start over.
        start = 0; total = null;
        this.patch(current, { downloaded: 0, total: null });
        continue;
      }
      if (result.status === -1 || result.status >= 500 || result.status === 401 || result.status === 429) {
        this.patch(current, { downloaded: start, total });
        return "network";
      }
      if (result.status !== 200 && result.status !== 206) {
        await native.deleteFile(item.file).catch(() => {});
        this.patch(current, { state: "failed", error: "server", downloaded: 0, total: null });
        return "failed";
      }
      if (result.total > 0) total = result.total;
      const whole = result.status === 200 || (total !== null && result.size >= total);
      if (!whole && result.size <= start) {
        await native.deleteFile(item.file).catch(() => {});
        this.patch(current, { state: "failed", error: "transfer", downloaded: 0, total: null });
        return "failed";
      }
      start = result.size;
      if (!whole) { this.patch(current, { downloaded: start, total }, false); continue; }
      const size = await native.completePart(item.file).catch(() => -1);
      this.patch(current, size > 0
        ? { state: "done", size, downloaded: size, total: size, error: null }
        : { state: "failed", error: "transfer", downloaded: 0, total: null });
      return size > 0 ? "done" : "failed";
    }
  }

  /** A listen the server couldn't be told about; sent once it can. The caller leaves Incognito listens out. */
  queuePlay(play: MusicPlay) {
    const owner = this.owner;
    if (!owner || !this.native) return;
    this.index.pendingPlays = [...this.index.pendingPlays, { owner, play }].slice(-PENDING_PLAY_LIMIT);
    this.changed();
  }

  /** Sends the listens played offline, oldest first; each leaves the list once the server has it. */
  async flushPlays() {
    await this.ready;
    const connection = this.connection;
    if (!connection || this.flushing) return;
    this.flushing = true;
    try {
      for (const entry of this.index.pendingPlays.filter((item) => item.owner === connection.owner)) {
        try { await connection.api.recordPlay(entry.play); }
        catch (error) {
          // A listen the server turned down (no longer a song, malformed) is dropped; any other failure waits.
          const status = (error as { status?: number })?.status;
          if (!status || status >= 500 || status === 401 || status === 429) break;
        }
        this.index.pendingPlays = this.index.pendingPlays.filter((item) => item !== entry);
        this.changed();
      }
    } finally { this.flushing = false; }
  }

  async freeBytes(): Promise<number | null> {
    return this.native ? await this.native.freeBytes().catch(() => null) : null;
  }
}

function unique<T>(values: readonly T[]): T[] { return [...new Set(values)]; }
