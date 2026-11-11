import type { PlaybackPosition } from "./playback";
import { validPlaybackPosition } from "./playback";

/**
 * Watch positions this device has not yet confirmed with the server.
 *
 * The player records its position here as it plays. An entry stays until the
 * server confirms a save of that position, so an app crash, a killed
 * background process or a failed save leaves the newest position on the device.
 * It is used when the video is resumed and sent to the server on the next start.
 *
 * Each entry also remembers `base`: the position this device last knew the
 * server to hold. If the server now holds something else, another device
 * played the video since, and its position is the newer one: the entry is not
 * used and is never sent over it.
 */
export type LocalPosition = PlaybackPosition & { at: number; base?: number | null };
type ServerVideo = { video_id: string; watch_position?: number | null; watch_duration?: number | null };
type Store = { getItemAsync(key: string): Promise<string | null>; setItemAsync(key: string, value: string): Promise<void> };
type Entries = Record<string, Record<string, LocalPosition>>;

const storageKey = "ytzero.tv.unsynced-positions";
// SecureStore values stay small: the newest few unsynced videos are plenty.
const maxEntries = 25;
const maxAge = 30 * 24 * 60 * 60_000;
// Written at most this often while playing; a pause, close or background writes at once.
const writeInterval = 5000;

export function localProgressStore(store: Store, now: () => number = Date.now) {
  let entries: Entries = {};
  let owner: string | null = null;
  let lastWrite = 0;
  let writing: Promise<void> = Promise.resolve();
  let dirty = false;

  const valid = (value: unknown): value is LocalPosition => {
    const item = value as LocalPosition | null;
    return Boolean(item) && Number.isFinite(item!.at) && validPlaybackPosition(item!)
      && (item!.base === undefined || item!.base === null || Number.isFinite(item!.base));
  };

  const prune = () => {
    const all = Object.entries(entries).flatMap(([key, videos]) => Object.entries(videos).map(([id, value]) => ({ key, id, value })));
    const cutoff = now() - maxAge;
    const keep = new Set(all.filter((item) => item.value.at >= cutoff).sort((a, b) => b.value.at - a.value.at).slice(0, maxEntries)
      .map((item) => `${item.key}\n${item.id}`));
    for (const item of all) if (!keep.has(`${item.key}\n${item.id}`)) delete entries[item.key]![item.id];
    for (const [key, videos] of Object.entries(entries)) if (!Object.keys(videos).length) delete entries[key];
  };

  const load = (async () => {
    try {
      const parsed = JSON.parse(await store.getItemAsync(storageKey) ?? "{}") as Entries;
      // Keep anything recorded while loading.
      for (const [key, videos] of Object.entries(parsed)) {
        if (!videos || typeof videos !== "object") continue;
        for (const [id, value] of Object.entries(videos)) {
          if (valid(value) && !entries[key]?.[id]) (entries[key] ??= {})[id] = value;
        }
      }
      prune();
    } catch { /* An unreadable store starts empty. */ }
  })();

  // Another device saved a different position after this device last synced.
  const movedElsewhere = (value: LocalPosition, video: ServerVideo) =>
    value.base !== undefined && Math.abs((video.watch_position ?? 0) - (value.base ?? 0)) >= 1;

  const write = () => {
    dirty = false;
    lastWrite = now();
    // Never write before the saved entries are read back, or they would be lost.
    writing = writing.then(() => load).then(() => store.setItemAsync(storageKey, JSON.stringify(entries))).catch(() => {});
    return writing;
  };

  const changed = (immediately: boolean) => {
    dirty = true;
    if (immediately || now() - lastWrite >= writeInterval) void write();
  };

  return {
    ready: load,
    /** The signed-in instance and profile whose positions are recorded and used. */
    setOwner(value: string | null) { owner = value; },
    /** The video was finished and marked watched: its position no longer matters. */
    clear(videoId: string) {
      if (!owner || !entries[owner]?.[videoId]) return;
      delete entries[owner]![videoId];
      prune();
      changed(true);
    },
    /**
     * Records the current position; `immediately` writes it now instead of within a few seconds.
     * `server` is the position the server held when this stretch of playback began.
     */
    record(videoId: string, value: PlaybackPosition, immediately = false, server?: number | null) {
      if (!owner || !validPlaybackPosition(value) || value.position <= 0) return;
      const videos = entries[owner] ??= {};
      const base = videos[videoId] ? videos[videoId]!.base : server;
      videos[videoId] = { position: value.position, duration: value.duration, at: now(), ...(base === undefined ? {} : { base }) };
      prune();
      changed(immediately);
    },
    /** The server saved this position; the entry goes if nothing newer was recorded since. */
    synced(videoId: string, saved: PlaybackPosition) {
      const videos = owner ? entries[owner] : undefined;
      const value = videos?.[videoId];
      // Within a second: positions recorded while the save was on its way still count.
      if (!value) return;
      if (Math.abs(value.position - saved.position) >= 1) {
        // Newer than this save, which the server now holds.
        value.base = saved.position;
        changed(false);
        return;
      }
      delete videos![videoId];
      prune();
      changed(true);
    },
    pending(videoId: string): LocalPosition | null {
      return (owner && entries[owner]?.[videoId]) || null;
    },
    /**
     * The video with this device's unsynced position, unless the server's
     * position shows another device played it since. The video may come from
     * an older list, so a mismatch only skips the entry here; `flush` reads
     * the server itself before dropping it.
     */
    apply<T extends ServerVideo>(video: T): T {
      const value = this.pending(video.video_id);
      if (!value || movedElsewhere(value, video)) return video;
      return { ...video, watch_position: value.position, watch_duration: value.duration };
    },
    /**
     * Sends every unsynced position of the current owner to the server, after
     * reading the server's current one: a position another device saved since
     * is newer, so this device's entry is dropped instead of sent over it.
     */
    async flush(save: (videoId: string, value: PlaybackPosition) => Promise<unknown>, current: (videoId: string) => Promise<ServerVideo>) {
      await load;
      const key = owner;
      if (!key) return;
      for (const [videoId, value] of Object.entries(entries[key] ?? {})) {
        if (owner !== key) return;
        const saved = { position: value.position, duration: value.duration };
        try {
          const video = await current(videoId);
          if (owner !== key || entries[key]?.[videoId] !== value) continue;
          if (movedElsewhere(value, video)) { this.clear(videoId); continue; }
          await save(videoId, saved);
          if (owner === key) this.synced(videoId, saved);
        } catch { /* Kept for the next attempt. */ }
      }
    },
    /** Writes a recording that is waiting for the next interval. */
    persist() { return dirty ? write() : writing; },
  };
}
export type LocalProgressStore = ReturnType<typeof localProgressStore>;
