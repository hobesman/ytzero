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
};

export function createQueue(seed: MusicSeed, seedKey: string | null, tracks: MusicTrack[], now: Date, fromTitle: string | null = null): MusicQueue {
  const queued = unique([], tracks);
  const from = fromTitle ? { title: fromTitle, count: queued.length } : null;
  return { seed, seedKey, tracks: queued, index: 0, startedAt: queued.length ? now.toISOString() : null, skipped: [], from };
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
  return { ...queue, tracks: queue.tracks.filter((_, at) => at !== index), from };
}

export function rateTrack(queue: MusicQueue, videoId: string, rating: 1 | -1 | null): MusicQueue {
  return { ...queue, tracks: queue.tracks.map((track) => track.videoId === videoId ? { ...track, rating } : track) };
}
