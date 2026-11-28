import { log } from "../logger";
import { decodeMovieToken } from "./alexaMovieSkill";
import { nowPlayingPosition, type NowPlaying } from "./alexaNowPlaying";

/** How often a playing title's place is saved to Plex. */
export const MOVIE_SYNC_INTERVAL_MS = 60_000;
/** A place this close to the one last saved isn't saved again. Seconds. */
export const MOVIE_SYNC_MIN_CHANGE_SECONDS = 20;
/** After an Echo drops a stream, how long an event or a new request has to show it still plays. */
export const MOVIE_DROP_GRACE_MS = 20_000;

export interface PlayingMovieRecord { userId: number; deviceId: string; record: NowPlaying }

export interface MovieProgressSyncDependencies {
  /** Every device's movie now playing that is still playing, across profiles. */
  playing: () => Promise<PlayingMovieRecord[]>;
  nowPlaying: (userId: number, deviceId: string) => Promise<NowPlaying | null>;
  saveNowPlaying: (userId: number, deviceId: string, record: NowPlaying) => Promise<void>;
  /** Saves a place in a title (seconds). */
  save: (itemId: string, position: number) => Promise<void>;
  now: () => number;
  setTimer?: (run: () => void, ms: number) => void;
}

/**
 * Keeps Plex up to date while a title plays, as alexaBookProgressSync.ts
 * keeps Audiobookshelf: the Echo sends no progress reports, so the place is
 * worked out from when the stream started and saved every minute, and an
 * Echo that drops the stream without a Stopped event is marked stopped at the
 * place it had reached. A movie stream starts at its offset, so the position
 * in the stream is the position in the title.
 */
export function createMovieProgressSync(dependencies: MovieProgressSyncDependencies) {
  const { now } = dependencies;
  const setTimer = dependencies.setTimer ?? ((run, ms) => { setTimeout(run, ms).unref?.(); });
  const lastSaved = new Map<string, number>();
  const opened = new Map<string, number>();
  let interval: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  function placeOf(record: NowPlaying, at: number): { itemId: string; position: number } | null {
    const itemId = decodeMovieToken(record.token);
    if (!itemId || record.state !== "playing" || !record.startedAt || !record.durationMs) return null;
    const position = nowPlayingPosition(record, at);
    if (position >= record.durationMs) return null;
    return { itemId, position: position / 1000 };
  }

  const unchanged = (a: NowPlaying | null, b: NowPlaying) => Boolean(a && a.token === b.token && a.state === b.state && a.updatedAt === b.updatedAt);

  async function save(itemId: string, position: number, reason: string): Promise<void> {
    try {
      await dependencies.save(itemId, position);
      lastSaved.set(itemId, position);
    } catch (error) {
      log.warn("alexa.movie_progress_failed", { itemId, reason, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      for (const { userId, deviceId, record } of await dependencies.playing()) {
        const place = placeOf(record, now());
        if (!place || Math.abs(place.position - (lastSaved.get(place.itemId) ?? -Infinity)) < MOVIE_SYNC_MIN_CHANGE_SECONDS) continue;
        if (!unchanged(await dependencies.nowPlaying(userId, deviceId), record)) continue;
        await save(place.itemId, place.position, "playing");
      }
    } catch (error) {
      log.warn("alexa.movie_sync_failed", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      ticking = false;
    }
  }

  async function settleDrop(userId: number, token: string, droppedAt: number): Promise<void> {
    if ((opened.get(`${userId}\n${token}`) ?? 0) >= droppedAt) return;
    const records = (await dependencies.playing()).filter((item) => item.userId === userId && item.record.token === token);
    for (const { deviceId, record } of records) {
      if (Date.parse(record.updatedAt) > droppedAt) continue;
      const place = placeOf(record, droppedAt);
      const offsetMs = nowPlayingPosition(record, droppedAt);
      if (!unchanged(await dependencies.nowPlaying(userId, deviceId), record)) continue;
      await dependencies.saveNowPlaying(userId, deviceId, { ...record, state: "stopped", offsetMs, startedAt: null, updatedAt: new Date(now()).toISOString() });
      if (place) await save(place.itemId, place.position, "dropped");
      log.info("alexa.movie_stream_dropped", { itemId: record.videoId, position: place ? Math.round(place.position) : null });
    }
  }

  return {
    tick,
    /** Starts the minute's saves, once: on the first movie stream. */
    start(): void {
      if (interval) return;
      interval = setInterval(() => void tick(), MOVIE_SYNC_INTERVAL_MS);
      interval.unref?.();
    },
    stop(): void {
      if (interval) clearInterval(interval);
      interval = null;
    },
    opened(userId: number, token: string): void {
      opened.set(`${userId}\n${token}`, now());
      while (opened.size > 256) opened.delete(opened.keys().next().value!);
    },
    dropped(userId: number, token: string): Promise<void> {
      const at = now();
      return new Promise((resolve) => setTimer(() => {
        settleDrop(userId, token, at).catch((error) => log.warn("alexa.movie_sync_failed", { error: error instanceof Error ? error.message : String(error) })).finally(resolve);
      }, MOVIE_DROP_GRACE_MS));
    },
  };
}

export type MovieProgressSync = ReturnType<typeof createMovieProgressSync>;
