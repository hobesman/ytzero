import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { log } from "../logger";
import type { AudiobookshelfClient, Book, ReadAloudFile } from "./audiobookshelfClient";
import { readAlongLines, type ReadAlongBook, type ReadAlongLine } from "./readAlong";

/**
 * A book's read-along lines, built once from its read-aloud EPUB and kept on
 * disk (rebuildable cache: the EPUB in Audiobookshelf is the source). A file
 * per book, named by its ID, holds the EPUB's size and date it came from, so
 * a replaced EPUB is read again.
 */

export const READ_ALONG_DIR = process.env.READ_ALONG_DIR ?? resolve(import.meta.dir, "../../../data/readalong");
const VERSION = 1;
const FAILURE_MS = 10 * 60_000;
const MEMORY = 4;

export type ReadAlongClient = Pick<AudiobookshelfClient, "book" | "fileRange">;

type Build = (read: (start: number, end: number) => Promise<Uint8Array>, size: number, book: ReadAlongBook) => Promise<ReadAlongLine[]>;

export interface ReadAlongCacheOptions {
  directory?: string;
  now?: () => number;
  build?: Build;
}

const keyOf = (file: ReadAloudFile) => `${VERSION}:${file.ino}:${file.size}:${file.modified}`;

export function createReadAlongCache(options: ReadAlongCacheOptions = {}) {
  const directory = options.directory ?? READ_ALONG_DIR;
  const now = options.now ?? Date.now;
  const build = options.build ?? readAlongLines;
  const memory = new Map<string, { key: string; lines: ReadAlongLine[] }>();
  const pending = new Map<string, Promise<ReadAlongLine[]>>();
  const failed = new Map<string, { key: string; at: number; message: string }>();

  const remember = (bookId: string, key: string, lines: ReadAlongLine[]) => {
    memory.delete(bookId);
    memory.set(bookId, { key, lines });
    while (memory.size > MEMORY) memory.delete(memory.keys().next().value!);
  };

  async function fromDisk(bookId: string, key: string): Promise<ReadAlongLine[] | null> {
    try {
      const saved = JSON.parse(await readFile(resolve(directory, `${bookId}.json`), "utf8"));
      return saved?.key === key && Array.isArray(saved.lines) ? saved.lines : null;
    } catch {
      return null;
    }
  }

  async function toDisk(bookId: string, key: string, lines: ReadAlongLine[]) {
    try {
      await mkdir(directory, { recursive: true });
      const path = resolve(directory, `${bookId}.json`);
      await writeFile(`${path}.tmp`, JSON.stringify({ key, lines }));
      await rename(`${path}.tmp`, path);
    } catch (error) {
      log.warn("books.readalong_cache_write_failed", { bookId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function made(client: ReadAlongClient, book: Book, file: ReadAloudFile, key: string): Promise<ReadAlongLine[]> {
    const startedAt = now();
    const read = (start: number, end: number) => client.fileRange(book.id, file.ino, Math.max(0, start), Math.min(file.size - 1, end));
    const lines = await build(read, file.size, book);
    log.info("books.readalong_built", { bookId: book.id, lines: lines.length, ms: now() - startedAt });
    await toDisk(book.id, key, lines);
    return lines;
  }

  return {
    /** The book's lines; [] when it has no read-aloud EPUB, null when it isn't a book. Throws when the EPUB can't be read. */
    async lines(client: ReadAlongClient, bookId: string): Promise<ReadAlongLine[] | null> {
      const book = await client.book(bookId);
      if (!book) return null;
      const file = book.readAloud;
      if (!file) return [];
      const key = keyOf(file);
      const kept = memory.get(bookId);
      if (kept?.key === key) return kept.lines;
      const failure = failed.get(bookId);
      if (failure?.key === key && now() - failure.at < FAILURE_MS) throw new Error(failure.message);
      const saved = await fromDisk(bookId, key);
      if (saved) { remember(bookId, key, saved); return saved; }
      const running = pending.get(bookId) ?? made(client, book, file, key);
      pending.set(bookId, running);
      try {
        const lines = await running;
        remember(bookId, key, lines);
        failed.delete(bookId);
        return lines;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (pending.get(bookId) === running) {
          failed.set(bookId, { key, at: now(), message });
          log.warn("books.readalong_failed", { bookId, error: message });
        }
        throw error;
      } finally {
        if (pending.get(bookId) === running) pending.delete(bookId);
      }
    },
  };
}

export type ReadAlongCache = ReturnType<typeof createReadAlongCache>;
