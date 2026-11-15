import type { MusicPlayerProgress, MusicTrackChange } from "../musicPlayerTypes";
import type { MusicEndReason, MusicPlay, MusicSeed, MusicTrack } from "./musicApi";

/** Songs kept queued after the one playing, so the player can always buffer the next. */
export const QUEUE_AHEAD = 3;
/** A song stopped this close to its end counts as finished. */
const NEAR_END_SECONDS = 8;

/**
 * The station as the phone sees it: every song handed to the player, in
 * player order, and which one is playing. Pure, so the rules are testable.
 */
export type MusicQueue = {
  seed: MusicSeed;
  /** The server's name for the seed, recorded with each play. */
  seedKey: string | null;
  tracks: MusicTrack[];
  index: number;
  /** When the current song started, ISO. */
  startedAt: string | null;
  skipped: string[];
  /** The album this queue opened with, and how many of its first songs are the album's. Null for a station. */
  from: { title: string; count: number } | null;
  /** Songs the listener queued by hand; they stay ahead of the station's refill. */
  queued: string[];
};

export function createQueue(seed: MusicSeed, seedKey: string | null, tracks: MusicTrack[], now: Date, fromTitle: string | null = null): MusicQueue {
  const queued = unique([], tracks);
  const from = fromTitle ? { title: fromTitle, count: queued.length } : null;
  return { seed, seedKey, tracks: queued, index: 0, startedAt: queued.length ? now.toISOString() : null, skipped: [], from, queued: [] };
}

/** The tracks in a random order (Fisher–Yates), for playing an album shuffled. */
export function shuffleTracks<T>(tracks: readonly T[], random: () => number = Math.random): T[] {
  const result = [...tracks];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

/** The album still playing, if any; null once the station after it has begun. */
export function playingFrom(queue: MusicQueue | null): string | null {
  return queue?.from && queue.index < queue.from.count ? queue.from.title : null;
}

/** Songs to add to the end, without any already queued. */
export function unique(existing: MusicTrack[], incoming: MusicTrack[]): MusicTrack[] {
  const seen = new Set(existing.map((track) => track.videoId));
  const result: MusicTrack[] = [];
  for (const track of incoming) {
    if (seen.has(track.videoId)) continue;
    seen.add(track.videoId);
    result.push(track);
  }
  return result;
}

export function appendTracks(queue: MusicQueue, incoming: MusicTrack[]): { queue: MusicQueue; added: MusicTrack[] } {
  const added = unique(queue.tracks, incoming);
  return { queue: { ...queue, tracks: [...queue.tracks, ...added] }, added };
}

export function remainingAhead(queue: MusicQueue): number {
  return Math.max(0, queue.tracks.length - queue.index - 1);
}

export function needsMore(queue: MusicQueue): boolean {
  return remainingAhead(queue) < QUEUE_AHEAD;
}

export function current(queue: MusicQueue | null): MusicTrack | null {
  return queue?.tracks[queue.index] ?? null;
}

export function upNext(queue: MusicQueue | null): MusicTrack[] {
  return queue ? queue.tracks.slice(queue.index + 1) : [];
}

/** What the station asks the server to leave out: everything handed out so far. */
export function served(queue: MusicQueue): string[] {
  return queue.tracks.map((track) => track.videoId).slice(-200);
}

export function endReason(change: Pick<MusicTrackChange, "reason">, progress: MusicPlayerProgress): MusicEndReason {
  const nearEnd = progress.duration > 0 && progress.position >= progress.duration - NEAR_END_SECONDS;
  if (change.reason === "auto" || change.reason === "repeat") return "completed";
  if (change.reason === "seek") return nearEnd ? "completed" : "skipped";
  return nearEnd ? "completed" : "stopped";
}

export function playFor(queue: MusicQueue, progress: MusicPlayerProgress, reason: MusicEndReason, startedAt: string | null): MusicPlay | null {
  if (!progress.videoId || !startedAt) return null;
  const duration = Math.max(0, Math.round(progress.duration));
  const listened = Math.max(0, Math.round(progress.position));
  // A song that never started playing is not a listen.
  if (listened < 1 && reason !== "completed") return null;
  return { videoId: progress.videoId, startedAt, listenedSeconds: duration ? Math.min(listened, duration) : listened, duration, endReason: reason, stationSeed: queue.seedKey };
}

export type TrackChangeResult = {
  queue: MusicQueue;
  /** The play to record for the song that just ended. */
  play: MusicPlay | null;
  /** The song after the new one, for the server to have ready. */
  prepare: string | null;
};

export function applyTrackChange(queue: MusicQueue, change: MusicTrackChange, now: Date): TrackChangeResult {
  const index = change.videoId ? queue.tracks.findIndex((track) => track.videoId === change.videoId) : -1;
  const startedAt = now.toISOString();
  let play: MusicPlay | null = null;
  let skipped = queue.skipped;
  if (change.previous && change.reason !== "playlist") {
    const reason = endReason(change, change.previous);
    play = playFor(queue, change.previous, reason, queue.startedAt);
    if (reason === "skipped" && !skipped.includes(change.previous.videoId)) skipped = [...skipped, change.previous.videoId].slice(-100);
  }
  const next = { ...queue, index: index >= 0 ? index : queue.index, startedAt, skipped };
  return { queue: next, play, prepare: next.tracks[next.index + 1]?.videoId ?? null };
}

/** The player was told to drop a song from the up-next list. */
export function removeTrack(queue: MusicQueue, index: number): MusicQueue {
  if (index <= queue.index || index >= queue.tracks.length) return queue;
  const from = queue.from && index < queue.from.count ? { ...queue.from, count: queue.from.count - 1 } : queue.from;
  const videoId = queue.tracks[index]!.videoId;
  return { ...queue, tracks: queue.tracks.filter((_, at) => at !== index), from, queued: queue.queued.filter((id) => id !== videoId) };
}

export function rateTrack(queue: MusicQueue, videoId: string, rating: 1 | -1 | null): MusicQueue {
  return { ...queue, tracks: queue.tracks.map((track) => track.videoId === videoId ? { ...track, rating } : track) };
}

/** What the native player must do to match an edited queue. */
export type QueueChange = { kind: "insert"; index: number; track: MusicTrack } | { kind: "move"; from: number; to: number };
export type QueueEdit = { queue: MusicQueue; change: QueueChange | null };

/** Where "Add to queue" goes: after the last song queued by hand that is still to come, so they play in the order added. */
export function handQueuedEnd(queue: MusicQueue): number {
  const hand = new Set(queue.queued);
  for (let at = queue.tracks.length - 1; at > queue.index; at--) if (hand.has(queue.tracks[at]!.videoId)) return at + 1;
  return queue.index + 1;
}

/** The song at `from` moved so it ends up at `to`; the playing song keeps playing. */
function moveItem(queue: MusicQueue, from: number, to: number): MusicQueue {
  const tracks = [...queue.tracks];
  const [item] = tracks.splice(from, 1);
  tracks.splice(to, 0, item!);
  let index = queue.index;
  if (from === index) index = to;
  else {
    if (from < index) index--;
    if (to <= index) index++;
  }
  return { ...queue, tracks, index };
}

/**
 * "Play next" or "Add to queue". A song already queued moves rather than
 * appearing twice; the one playing stays where it is.
 */
export function queueTrack(queue: MusicQueue, track: MusicTrack, placement: "next" | "last"): QueueEdit {
  const from = queue.tracks.findIndex((entry) => entry.videoId === track.videoId);
  if (from === queue.index) return { queue, change: null };
  const insertAt = placement === "next" ? queue.index + 1 : handQueuedEnd(queue);
  const queued = [...queue.queued.filter((id) => id !== track.videoId), track.videoId].slice(-200);
  if (from < 0) {
    const tracks = [...queue.tracks];
    tracks.splice(insertAt, 0, track);
    const album = queue.from && insertAt < queue.from.count ? { ...queue.from, count: queue.from.count + 1 } : queue.from;
    return { queue: { ...queue, tracks, queued, from: album }, change: { kind: "insert", index: insertAt, track } };
  }
  const to = from < insertAt ? insertAt - 1 : insertAt;
  if (to === from) return { queue: { ...queue, queued }, change: null };
  return { queue: { ...moveItem(queue, from, to), queued }, change: { kind: "move", from, to } };
}

/** The listener dragged a song in Up next. Only songs still to come move. */
export function moveUpcoming(queue: MusicQueue, from: number, to: number): QueueEdit {
  const last = queue.tracks.length - 1;
  if (from <= queue.index || from > last || from === to) return { queue, change: null };
  const target = Math.max(queue.index + 1, Math.min(to, last));
  if (target === from) return { queue, change: null };
  return { queue: moveItem(queue, from, target), change: { kind: "move", from, to: target } };
}
