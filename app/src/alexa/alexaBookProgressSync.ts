import type { Book } from "../audiobookshelf/audiobookshelfClient";
import { log } from "../logger";
import { bookPosition } from "./alexaBookMath";
import { decodeBookToken } from "./alexaBookSkill";
import { nowPlayingPosition, type NowPlaying } from "./alexaNowPlaying";

/** How often a playing book's place is saved to Audiobookshelf. */
export const BOOK_SYNC_INTERVAL_MS = 60_000;
/** A place this close to the one last saved isn't saved again. Seconds. */
export const BOOK_SYNC_MIN_CHANGE_SECONDS = 20;
/** After an Echo drops a book's stream, how long an event or a new request has to show it still plays. */
export const BOOK_DROP_GRACE_MS = 20_000;

export interface PlayingBookRecord { userId: number; deviceId: string; record: NowPlaying }

export interface BookProgressSyncDependencies {
  /** Every device's book now playing that is still playing, across profiles. */
  playing: () => Promise<PlayingBookRecord[]>;
  nowPlaying: (userId: number, deviceId: string) => Promise<NowPlaying | null>;
  saveNowPlaying: (userId: number, deviceId: string, record: NowPlaying) => Promise<void>;
  book: (bookId: string) => Promise<Book | null>;
  saveProgress: (bookId: string, update: { currentTime: number; duration: number }) => Promise<void>;
  now: () => number;
  setTimer?: (run: () => void, ms: number) => void;
}

/**
 * Keeps Audiobookshelf up to date while a book plays. The Echo is asked for a
 * progress report every minute but never sends one, only Started and Stopped,
 * so the place would otherwise reach Audiobookshelf only on a pause, and a
 * restart mid-book would lose everything since it started. Instead the place
 * is worked out from when the stream started, as the room tablet does, and
 * saved every minute.
 *
 * It also notices an Echo that drops a book's stream without saying it
 * stopped (unplugged, off the network): the stream's one long request ends
 * early, and when no event or new request follows, the book is marked stopped
 * at the place it had reached.
 */
export function createBookProgressSync(dependencies: BookProgressSyncDependencies) {
  const { now } = dependencies;
  const setTimer = dependencies.setTimer ?? ((run, ms) => { setTimeout(run, ms).unref?.(); });
  const lastSaved = new Map<string, number>();
  const opened = new Map<string, number>();
  let interval: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  /** The book place a record has reached now, or null when it can't be told. */
  async function placeOf(record: NowPlaying, at: number): Promise<{ book: Book; position: number } | null> {
    const decoded = decodeBookToken(record.token);
    if (!decoded || record.state !== "playing" || !record.startedAt || !record.durationMs) return null;
    const fileOffset = nowPlayingPosition(record, at);
    // A file that has played out is the next one's business, or a record nothing has updated since.
    if (fileOffset >= record.durationMs) return null;
    const book = await dependencies.book(decoded.bookId).catch(() => null);
    return book?.tracks[decoded.fileIndex] ? { book, position: bookPosition(book, decoded.fileIndex, fileOffset / 1000) } : null;
  }

  const unchanged = (a: NowPlaying | null, b: NowPlaying) => Boolean(a && a.token === b.token && a.state === b.state && a.updatedAt === b.updatedAt);

  async function save(book: Book, position: number, reason: string): Promise<void> {
    try {
      await dependencies.saveProgress(book.id, { currentTime: position, duration: book.duration });
      lastSaved.set(book.id, position);
    } catch (error) {
      log.warn("alexa.book_progress_failed", { bookId: book.id, reason, error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Saves each playing book's place, when it has moved on. */
  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      for (const { userId, deviceId, record } of await dependencies.playing()) {
        const place = await placeOf(record, now());
        if (!place || Math.abs(place.position - (lastSaved.get(place.book.id) ?? -Infinity)) < BOOK_SYNC_MIN_CHANGE_SECONDS) continue;
        // An event that came in meanwhile saved the real place; this estimate mustn't follow it.
        if (!unchanged(await dependencies.nowPlaying(userId, deviceId), record)) continue;
        await save(place.book, place.position, "playing");
      }
    } catch (error) {
      log.warn("alexa.book_sync_failed", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      ticking = false;
    }
  }

  async function settleDrop(userId: number, token: string, droppedAt: number): Promise<void> {
    if ((opened.get(`${userId}\n${token}`) ?? 0) >= droppedAt) return;
    const records = (await dependencies.playing()).filter((item) => item.userId === userId && item.record.token === token);
    for (const { deviceId, record } of records) {
      if (Date.parse(record.updatedAt) > droppedAt) continue;
      const place = await placeOf(record, droppedAt);
      const offsetMs = nowPlayingPosition(record, droppedAt);
      if (!unchanged(await dependencies.nowPlaying(userId, deviceId), record)) continue;
      await dependencies.saveNowPlaying(userId, deviceId, { ...record, state: "stopped", offsetMs, startedAt: null, updatedAt: new Date(now()).toISOString() });
      if (place) await save(place.book, place.position, "dropped");
      log.info("alexa.book_stream_dropped", { bookId: record.videoId, position: place ? Math.round(place.position) : null });
    }
  }

  return {
    tick,
    /** Starts the minute's saves, once: on the first book stream, so a server without books never runs them. */
    start(): void {
      if (interval) return;
      interval = setInterval(() => void tick(), BOOK_SYNC_INTERVAL_MS);
      interval.unref?.();
    },
    stop(): void {
      if (interval) clearInterval(interval);
      interval = null;
    },
    /** A book stream was requested: a drop of an earlier request for it is no drop. */
    opened(userId: number, token: string): void {
      opened.set(`${userId}\n${token}`, now());
      while (opened.size > 256) opened.delete(opened.keys().next().value!);
    },
    /** A book stream's request ended before its file did. */
    dropped(userId: number, token: string): Promise<void> {
      const at = now();
      return new Promise((resolve) => setTimer(() => {
        settleDrop(userId, token, at).catch((error) => log.warn("alexa.book_sync_failed", { error: error instanceof Error ? error.message : String(error) })).finally(resolve);
      }, BOOK_DROP_GRACE_MS));
    },
  };
}

export type BookProgressSync = ReturnType<typeof createBookProgressSync>;
