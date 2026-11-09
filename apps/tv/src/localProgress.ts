import type { PlaybackPosition } from "./playback";
import { validPlaybackPosition } from "./playback";

/**
 * Watch positions this device has not yet confirmed with the server.
 *
 * The player records its position here as it plays. An entry stays until the
 * server confirms a save of that position, so an app crash, a killed
 * background process or a failed save leaves the newest position on the device.
 * It is used when the video is resumed and sent to the server on the next start.
 */
export type LocalPosition = PlaybackPosition & { at: number };
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
    return Boolean(item) && Number.isFinite(item!.at) && validPlaybackPosition(item!);
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
    /** Records the current position; `immediately` writes it now instead of within a few seconds. */
    record(videoId: string, value: PlaybackPosition, immediately = false) {
      if (!owner || !validPlaybackPosition(value) || value.position <= 0) return;
      (entries[owner] ??= {})[videoId] = { position: value.position, duration: value.duration, at: now() };
      prune();
      changed(immediately);
    },
    /** The server saved this position; the entry goes if nothing newer was recorded since. */
    synced(videoId: string, saved: PlaybackPosition) {
      const videos = owner ? entries[owner] : undefined;
      const value = videos?.[videoId];
      // Within a second: positions recorded while the save was on its way still count.
      if (!value || Math.abs(value.position - saved.position) >= 1) return;
      delete videos![videoId];
      prune();
      changed(true);
    },
    pending(videoId: string): LocalPosition | null {
      return (owner && entries[owner]?.[videoId]) || null;
    },
    /** The video with this device's unsynced position, which is newer than the server's. */
    apply<T extends { video_id: string; watch_position?: number | null; watch_duration?: number | null }>(video: T): T {
      const value = this.pending(video.video_id);
      return value ? { ...video, watch_position: value.position, watch_duration: value.duration } : video;
    },
    /** Sends every unsynced position of the current owner to the server. */
    async flush(save: (videoId: string, value: PlaybackPosition) => Promise<unknown>) {
      await load;
      const key = owner;
      if (!key) return;
      for (const [videoId, value] of Object.entries(entries[key] ?? {})) {
        if (owner !== key) return;
        const saved = { position: value.position, duration: value.duration };
        try {
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
