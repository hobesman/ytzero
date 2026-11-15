import type { MusicEndReason, MusicPlay, MusicSeed, MusicTrack } from "./musicApi";

/** Under this, a skip says "not now" rather than "not this one". */
export const QUICK_SKIP_SECONDS = 30;
/** Fetch more of the station once this few songs are left. */
const REFILL_BELOW = 3;

/** A station or album as it plays: the songs fetched so far and where it is. */
export type MusicQueue = {
  seed: MusicSeed;
  seedKey: string | null;
  tracks: MusicTrack[];
  index: number;
  /** Songs skipped this session, sent back so the station learns. */
  skipped: string[];
  /** The album or playlist the first songs came from, while they play. */
  from: { title: string; count: number } | null;
};

export function createQueue(seed: MusicSeed, seedKey: string | null, tracks: MusicTrack[], fromTitle: string | null = null): MusicQueue {
  return { seed, seedKey, tracks: dedupe(tracks), index: 0, skipped: [], from: fromTitle ? { title: fromTitle, count: tracks.length } : null };
}

function dedupe(tracks: readonly MusicTrack[]): MusicTrack[] {
  const seen = new Set<string>();
  return tracks.filter((track) => !seen.has(track.videoId) && Boolean(seen.add(track.videoId)));
}

export const current = (queue: MusicQueue | null): MusicTrack | null => queue?.tracks[queue.index] ?? null;

/** Every song handed to the player so far, for the server's station. */
export const served = (queue: MusicQueue): string[] => queue.tracks.slice(0, queue.index + 1).map((track) => track.videoId);

export const needsMore = (queue: MusicQueue): boolean => queue.tracks.length - queue.index - 1 < REFILL_BELOW;

export function appendTracks(queue: MusicQueue, tracks: readonly MusicTrack[]): MusicQueue {
  const known = new Set(queue.tracks.map((track) => track.videoId));
  return { ...queue, tracks: [...queue.tracks, ...tracks.filter((track) => !known.has(track.videoId))] };
}

/** The tracks in a random order (Fisher–Yates). */
export function shuffleTracks<T>(tracks: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...tracks];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

export function moveTo(queue: MusicQueue, index: number, skippedCurrent: boolean): MusicQueue {
  const playing = current(queue);
  const skipped = skippedCurrent && playing ? [...queue.skipped, playing.videoId].slice(-200) : queue.skipped;
  return { ...queue, index: Math.max(0, Math.min(index, queue.tracks.length - 1)), skipped };
}

export function rateTrack(queue: MusicQueue, videoId: string, rating: 1 | -1 | null): MusicQueue {
  return { ...queue, tracks: queue.tracks.map((track) => track.videoId === videoId ? { ...track, rating } : track) };
}

/** Drops a song the listener said "not this one" to from what's still to come. */
export function removeUpcoming(queue: MusicQueue, videoId: string): MusicQueue {
  const tracks = queue.tracks.filter((track, index) => index <= queue.index || track.videoId !== videoId);
  return { ...queue, tracks };
}

/** Whether the "From <album>" label still applies to the song at the current index. */
export const fromTitle = (queue: MusicQueue | null): string | null =>
  queue?.from && queue.index < queue.from.count ? queue.from.title : null;

export function endReason(listenedSeconds: number, duration: number | null, finished: boolean, skipped: boolean): MusicEndReason {
  if (finished || (duration && listenedSeconds >= duration - 2)) return "completed";
  return skipped ? "skipped" : "stopped";
}

export function playRecord(queue: MusicQueue, track: MusicTrack, startedAt: Date, listenedSeconds: number, reason: MusicEndReason): MusicPlay {
  const duration = track.duration ?? null;
  return {
    videoId: track.videoId, startedAt: startedAt.toISOString(),
    listenedSeconds: Math.round(duration ? Math.min(listenedSeconds, duration) : listenedSeconds),
    duration, endReason: reason, stationSeed: queue.seedKey,
  };
}
