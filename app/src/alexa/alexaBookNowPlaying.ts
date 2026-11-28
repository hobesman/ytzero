import type { Book } from "../audiobookshelf/audiobookshelfClient";
import { bookPosition, chapterAt, chaptersOf } from "./alexaBookMath";
import { decodeBookToken } from "./alexaBookSkill";

/** A book's place as the room tablet shows it: the chapter and the whole book. Milliseconds. */
export interface BookNowPlaying {
  bookId: string;
  author: string;
  chapterTitle: string | null;
  /** 0-based, with the count, for "Chapter 3 of 20". */
  chapterIndex: number | null;
  chapterCount: number;
  chapterPositionMs: number | null;
  chapterDurationMs: number | null;
  bookPositionMs: number;
  bookDurationMs: number;
}

/** Where `fileOffsetMs` into the token's file is in the book and its chapter. Null when the token isn't this book's. */
export function bookNowPlaying(book: Book, token: string, fileOffsetMs: number): BookNowPlaying | null {
  const decoded = decodeBookToken(token);
  if (!decoded || decoded.bookId !== book.id || !book.tracks[decoded.fileIndex]) return null;
  const position = bookPosition(book, decoded.fileIndex, fileOffsetMs / 1000);
  const chapter = chapterAt(book, position);
  return {
    bookId: book.id,
    author: book.author,
    chapterTitle: chapter ? chapter.chapter.title || null : null,
    chapterIndex: chapter?.index ?? null,
    chapterCount: chaptersOf(book).length,
    chapterPositionMs: chapter ? Math.round((position - chapter.chapter.start) * 1000) : null,
    chapterDurationMs: chapter ? Math.round((chapter.chapter.end - chapter.chapter.start) * 1000) : null,
    bookPositionMs: Math.round(position * 1000),
    bookDurationMs: Math.round(book.duration * 1000),
  };
}

const CACHE_MS = 2 * 60_000;
const CACHE_LIMIT = 32;

/** Books by ID for a screen that polls, kept a couple of minutes. A failed lookup is null and isn't kept. */
export function createBookCache(load: (bookId: string) => Promise<Book | null>, now: () => number = Date.now) {
  const cache = new Map<string, { book: Book; at: number }>();
  return async (bookId: string): Promise<Book | null> => {
    const hit = cache.get(bookId);
    if (hit && now() - hit.at < CACHE_MS) return hit.book;
    const book = await load(bookId).catch(() => null);
    if (book) {
      cache.delete(bookId);
      cache.set(bookId, { book, at: now() });
      while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    }
    return book;
  };
}
