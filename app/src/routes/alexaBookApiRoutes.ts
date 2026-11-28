import type { Context, Hono } from "hono";
import { createBookCache } from "../alexa/alexaBookNowPlaying";
import { chaptersOf } from "../alexa/alexaBookMath";
import { playRoomBook, RoomControlError, roomSpelling, type RoomControlDependencies } from "../alexa/alexaRoomControl";
import { createAlexaRoomBooks, type AlexaRoomBook, type AlexaRoomBooks } from "../alexa/alexaRoomBooks";
import { normalizeRoomName, type AlexaRoomStore } from "../alexa/alexaRooms";
import type { AlexaRoomSettings } from "../alexa/alexaRoomSettings";
import { HomeAssistantError } from "../alexa/homeAssistant";
import {
  AudiobookshelfError, defaultAudiobookshelf, isBookId, type AudiobookshelfClient, type Book, type BookProgress, type BookSummary,
} from "../audiobookshelf/audiobookshelfClient";
import { createReadAlongCache, type ReadAlongCache } from "../audiobookshelf/readAlongCache";

type ApiEnvironment = { Variables: { userId: number } };
type ApiContext = Context<ApiEnvironment>;

export type BookClient = Pick<AudiobookshelfClient, "bookLibraries" | "libraryBooks" | "search" | "book" | "inProgress" | "allProgress" | "progress" | "cover" | "fileRange">;

export interface AlexaBookApiDependencies {
  currentUserId: (context: ApiContext) => number;
  rooms: AlexaRoomStore;
  settings: AlexaRoomSettings;
  now: () => number;
  /** Room controls, or why there are none (Home Assistant not configured). */
  controls: () => RoomControlDependencies | string;
  audiobookshelf?: () => BookClient | { disabled: string };
  roomBooks?: AlexaRoomBooks;
  readAlong?: ReadAlongCache;
}

const PAGE_SIZE = 40;

/** The library's orders: newest added (the default), a shuffle, or by title. Audiobookshelf's own sort keys. */
const LIBRARY_SORTS = {
  newest: { sort: "addedAt", desc: true },
  random: { sort: "random", desc: false },
  title: { sort: "media.metadata.title", desc: false },
} as const;
export type LibrarySort = keyof typeof LIBRARY_SORTS;

const withProgress = (book: BookSummary, progress: Map<string, BookProgress>) => {
  const saved = progress.get(book.id);
  return { ...book, progress: saved ? { currentTime: saved.currentTime, progress: saved.progress, isFinished: saved.isFinished } : null };
};

const publicBook = (book: Book, saved: BookProgress | null) => ({
  id: book.id, libraryId: book.libraryId, title: book.title, subtitle: book.subtitle, author: book.author, narrator: book.narrator,
  series: book.series, duration: book.duration, files: book.tracks.length,
  chapters: chaptersOf(book).map((chapter, index) => ({ index, start: chapter.start, end: chapter.end, title: chapter.title })),
  progress: saved ? { currentTime: saved.currentTime, progress: saved.progress, isFinished: saved.isFinished, lastUpdate: saved.lastUpdate } : null,
});

const publicRoomBook = (book: AlexaRoomBook | null) => book && { room: book.room, bookId: book.bookId, title: book.title, startSeconds: book.startSeconds, savedAt: book.savedAt };

/**
 * The room tablet's Books tab: Audiobookshelf's books in progress, its
 * libraries with search, a book's chapters, covers, and the book queued for a
 * room, which "ask hoban books to play my book" starts. The API key stays here.
 */
export function registerAlexaBookApiRoutes(api: Hono<ApiEnvironment>, dependencies: AlexaBookApiDependencies): void {
  const { currentUserId, rooms, settings, now } = dependencies;
  const audiobookshelf = dependencies.audiobookshelf ?? defaultAudiobookshelf;
  const roomBooks = dependencies.roomBooks ?? createAlexaRoomBooks();
  const readAlong = dependencies.readAlong ?? createReadAlongCache();
  const client = (context: ApiContext): BookClient | Response => {
    const found = audiobookshelf();
    return "disabled" in found ? context.json({ error: `Audiobookshelf isn't configured: ${found.disabled}` }, 503) : found;
  };
  const failure = (context: ApiContext, error: unknown) => {
    if (error instanceof AudiobookshelfError) return context.json({ error: error.message }, 502);
    if (error instanceof RoomControlError) return context.json({ error: error.message }, error.status);
    if (error instanceof HomeAssistantError) return context.json({ error: error.message }, 502);
    throw error;
  };
  const progressOf = (books: BookClient) => books.allProgress().catch(() => new Map<string, BookProgress>());

  api.get("/alexa/books", async (context) => {
    const found = audiobookshelf();
    if ("disabled" in found) return context.json({ enabled: false, reason: found.disabled, libraries: [] });
    try {
      return context.json({ enabled: true, libraries: await found.bookLibraries() });
    } catch (error) {
      return failure(context, error);
    }
  });

  api.get("/alexa/books/continue", async (context) => {
    const books = client(context);
    if (books instanceof Response) return books;
    try {
      const [list, progress] = await Promise.all([books.inProgress(20), progressOf(books)]);
      return context.json({ books: list.map((book) => withProgress(book, progress)) });
    } catch (error) {
      return failure(context, error);
    }
  });

  // ?q= searches every book library; otherwise one page of a library (?libraryId=, default the first), in ?sort= order.
  api.get("/alexa/books/library", async (context) => {
    const books = client(context);
    if (books instanceof Response) return books;
    const query = (context.req.query("q") ?? "").trim().slice(0, 200);
    const page = Math.max(0, Math.floor(Number(context.req.query("page")) || 0));
    try {
      const libraries = await books.bookLibraries();
      const progress = await progressOf(books);
      if (query) {
        const found = (await Promise.all(libraries.map((library) => books.search(library.id, query, 25)))).flatMap((result) => result.books);
        return context.json({ books: found.map((book) => withProgress(book, progress)), total: found.length, page: 0, pageSize: found.length });
      }
      const libraryId = context.req.query("libraryId") ?? libraries[0]?.id;
      if (!libraryId || !libraries.some((library) => library.id === libraryId)) return context.json({ books: [], total: 0, page, pageSize: PAGE_SIZE });
      const asked = context.req.query("sort") ?? "";
      const order = Object.hasOwn(LIBRARY_SORTS, asked) ? LIBRARY_SORTS[asked as LibrarySort] : LIBRARY_SORTS.newest;
      const result = await books.libraryBooks(libraryId, { page, limit: PAGE_SIZE, ...order });
      return context.json({ books: result.books.map((book) => withProgress(book, progress)), total: result.total, page, pageSize: PAGE_SIZE });
    } catch (error) {
      return failure(context, error);
    }
  });

  api.get("/alexa/books/items/:id", async (context) => {
    const books = client(context);
    if (books instanceof Response) return books;
    const id = context.req.param("id");
    if (!isBookId(id)) return context.json({ error: "not found" }, 404);
    try {
      const [book, saved] = await Promise.all([books.book(id), books.progress(id).catch(() => null)]);
      return book ? context.json({ book: publicBook(book, saved) }) : context.json({ error: "not found" }, 404);
    } catch (error) {
      return failure(context, error);
    }
  });

  // The book's sentences timed in the audiobook, from its read-aloud EPUB: lyrics mode on the room tablet. [] when it has none.
  api.get("/alexa/books/items/:id/readalong", async (context) => {
    const books = client(context);
    if (books instanceof Response) return books;
    const id = context.req.param("id");
    if (!isBookId(id)) return context.json({ error: "not found" }, 404);
    try {
      const lines = await readAlong.lines(books, id);
      return lines ? context.json({ lines }) : context.json({ error: "not found" }, 404);
    } catch (error) {
      if (error instanceof AudiobookshelfError) return failure(context, error);
      return context.json({ error: `The read-along text couldn't be read: ${error instanceof Error ? error.message : String(error)}` }, 502);
    }
  });

  api.get("/alexa/books/items/:id/cover", async (context) => {
    const books = client(context);
    if (books instanceof Response) return books;
    const id = context.req.param("id");
    if (!isBookId(id)) return context.json({ error: "not found" }, 404);
    const upstream = await books.cover(id, context.req.raw.signal).catch(() => null);
    if (!upstream?.ok || !upstream.body) return context.json({ error: "not found" }, 404);
    return new Response(upstream.body, { headers: { "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  });

  const roomParam = (context: ApiContext) => normalizeRoomName(context.req.param("room"));

  api.get("/alexa/rooms/:room/book", async (context) => {
    const room = roomParam(context);
    if (!room) return context.json({ error: "invalid room" }, 400);
    return context.json({ book: publicRoomBook(await roomBooks.get(currentUserId(context), room)) });
  });

  // Queues a book for the room: { bookId, chapter?: index, startSeconds?: seconds, play?: true }. With neither, it starts from its saved place.
  api.put("/alexa/rooms/:room/book", async (context) => {
    const room = roomParam(context);
    const body = await context.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!room || !body) return context.json({ error: "invalid room or body" }, 400);
    if (!isBookId(body.bookId)) return context.json({ error: "bookId is required" }, 400);
    const books = client(context);
    if (books instanceof Response) return books;
    let book: Book | null;
    try {
      book = await books.book(body.bookId);
    } catch (error) {
      return failure(context, error);
    }
    if (!book) return context.json({ error: "Audiobookshelf has no such book" }, 404);
    let startSeconds: number | null = null;
    if (body.chapter != null) {
      const chapter = chaptersOf(book)[Number(body.chapter)];
      if (!Number.isInteger(Number(body.chapter)) || !chapter) return context.json({ error: "no such chapter" }, 400);
      startSeconds = chapter.start;
    } else if (body.startSeconds != null) {
      const seconds = Number(body.startSeconds);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds >= book.duration) return context.json({ error: "startSeconds is outside the book" }, 400);
      startSeconds = seconds;
    }
    const userId = currentUserId(context);
    const spelled = await roomSpelling(await rooms.devices(userId), settings, userId, room);
    const queued = publicRoomBook(await roomBooks.save(userId, spelled, { bookId: book.id, title: book.title, startSeconds }, now()));
    if (body.play !== true) return context.json({ book: queued });
    const ready = dependencies.controls();
    if (typeof ready === "string") return context.json({ book: queued, error: ready }, 503);
    try {
      return context.json({ book: queued, started: await playRoomBook(ready, userId, spelled) });
    } catch (error) {
      if (error instanceof RoomControlError || error instanceof HomeAssistantError) {
        return context.json({ book: queued, error: error.message }, error instanceof RoomControlError ? error.status : 502);
      }
      throw error;
    }
  });

  api.delete("/alexa/rooms/:room/book", async (context) => {
    const room = roomParam(context);
    if (!room) return context.json({ error: "invalid room" }, 400);
    return await roomBooks.clear(currentUserId(context), room) ? context.json({ ok: true }) : context.json({ error: "not found" }, 404);
  });
}

let sharedCache: { client: BookClient; load: (bookId: string) => Promise<Book | null> } | null = null;

/** Books for the rooms list's now playing, cached; null when Audiobookshelf isn't configured. */
export function roomBookLoader(audiobookshelf: () => BookClient | { disabled: string } = defaultAudiobookshelf): ((bookId: string) => Promise<Book | null>) | null {
  const found = audiobookshelf();
  if ("disabled" in found) return null;
  if (sharedCache?.client !== found) sharedCache = { client: found, load: createBookCache((bookId) => found.book(bookId)) };
  return sharedCache.load;
}
