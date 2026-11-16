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
  /** Songs the listener queued by hand; they stay ahead of the station's refill. */
  queued: string[];
};

export function createQueue(seed: MusicSeed, seedKey: string | null, tracks: MusicTrack[], fromTitle: string | null = null): MusicQueue {
  return { seed, seedKey, tracks: dedupe(tracks), index: 0, skipped: [], from: fromTitle ? { title: fromTitle, count: tracks.length } : null, queued: [] };
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
  return { ...queue, tracks, queued: queue.queued.filter((id) => id !== videoId) };
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

/** Where "Add to queue" goes: after the last song queued by hand that is still to come, so they play in the order added. */
export function handQueuedEnd(queue: MusicQueue): number {
  const hand = new Set(queue.queued);
  for (let at = queue.tracks.length - 1; at > queue.index; at -= 1) if (hand.has(queue.tracks[at].videoId)) return at + 1;
  return queue.index + 1;
}

/** The song at `from` moved so it ends up at `to`; the playing song keeps playing. */
function moveItem(queue: MusicQueue, from: number, to: number): MusicQueue {
  const tracks = [...queue.tracks];
  const [item] = tracks.splice(from, 1);
  tracks.splice(to, 0, item);
  let index = queue.index;
  if (from === index) index = to;
  else {
    if (from < index) index -= 1;
    if (to <= index) index += 1;
  }
  return { ...queue, tracks, index };
}

/**
 * "Play next" or "Add to queue". A song already queued moves rather than
 * appearing twice; the one playing stays where it is.
 */
export function queueTrack(queue: MusicQueue, track: MusicTrack, placement: "next" | "last"): MusicQueue {
  const from = queue.tracks.findIndex((entry) => entry.videoId === track.videoId);
  if (from === queue.index) return queue;
  const insertAt = placement === "next" ? queue.index + 1 : handQueuedEnd(queue);
  const queued = [...queue.queued.filter((id) => id !== track.videoId), track.videoId].slice(-200);
  if (from < 0) {
    const tracks = [...queue.tracks];
    tracks.splice(insertAt, 0, track);
    const album = queue.from && insertAt < queue.from.count ? { ...queue.from, count: queue.from.count + 1 } : queue.from;
    return { ...queue, tracks, queued, from: album };
  }
  const to = from < insertAt ? insertAt - 1 : insertAt;
  return { ...(to === from ? queue : moveItem(queue, from, to)), queued };
}

/** The listener moved a song in Up next. Only songs still to come move, and never above the one playing. */
export function moveUpcoming(queue: MusicQueue, from: number, to: number): MusicQueue {
  const last = queue.tracks.length - 1;
  if (from <= queue.index || from > last) return queue;
  const target = Math.max(queue.index + 1, Math.min(to, last));
  return target === from ? queue : moveItem(queue, from, target);
}
