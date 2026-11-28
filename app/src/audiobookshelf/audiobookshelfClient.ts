/**
 * The user's Audiobookshelf server, as the Hoban Books skill and the room
 * tablet use it: libraries, books, chapters, audio files and listening
 * progress. Configured only by machine-bound environment variables and off
 * until both are set. The API key is a secret: it never leaves this module in
 * a log line, an API response or a link handed to an Echo.
 *
 * Checked against Audiobookshelf 2.38.0 (server/routers/ApiRouter.js).
 */
export interface AudiobookshelfConfig {
  /** Where this server reaches Audiobookshelf, such as http://127.0.0.1:8089. */
  url: string;
  /** An API key (Settings → API Keys) for the Audiobookshelf user whose progress the Echo shares. */
  apiKey: string;
}

type Environment = Record<string, string | undefined>;

const unquote = (value: string | undefined) => (value ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();

/** The configuration, or why the connection is off. */
export function audiobookshelfConfig(environment: Environment = process.env): AudiobookshelfConfig | { disabled: string } {
  const url = unquote(environment.YTZERO_AUDIOBOOKSHELF_URL).replace(/\/+$/, "");
  const apiKey = unquote(environment.YTZERO_AUDIOBOOKSHELF_API_KEY);
  if (!url && !apiKey) return { disabled: "YTZERO_AUDIOBOOKSHELF_URL and YTZERO_AUDIOBOOKSHELF_API_KEY are not set" };
  if (!url) return { disabled: "YTZERO_AUDIOBOOKSHELF_URL is not set" };
  if (!apiKey) return { disabled: "YTZERO_AUDIOBOOKSHELF_API_KEY is not set" };
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { disabled: "YTZERO_AUDIOBOOKSHELF_URL is not a valid address" }; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { disabled: "YTZERO_AUDIOBOOKSHELF_URL must start with http:// or https://" };
  return { url: parsed.origin + parsed.pathname.replace(/\/+$/, ""), apiKey };
}

export class AudiobookshelfError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
  }
}

/** One audio file of a book, in play order, with where it starts in the book. */
export interface BookTrack {
  /** 0-based place in the book's play order. */
  index: number;
  /** Audiobookshelf's file ID, for /api/items/:id/file/:ino. */
  ino: string;
  /** Seconds into the book where this file starts. */
  startOffset: number;
  duration: number;
  /** aac, mp3, opus, flac… as ffprobe names it. */
  codec: string;
  mimeType: string;
}

export interface BookChapter { start: number; end: number; title: string }

export interface BookSeries { id: string; name: string; sequence: string | null }

/** A book, as the skill and the tablet need it. Times are seconds. */
export interface Book {
  id: string;
  libraryId: string;
  title: string;
  subtitle: string | null;
  author: string;
  narrator: string | null;
  series: BookSeries[];
  duration: number;
  tracks: BookTrack[];
  chapters: BookChapter[];
  /** A read-aloud EPUB among the book's files (Storyteller's, with the narration's timing), if there is one. */
  readAloud?: ReadAloudFile | null;
}

export interface ReadAloudFile { ino: string; size: number; modified: number }

/** "Title (readaloud).epub", "read-along", "Read Aloud": the name is all that marks one. */
const READ_ALOUD_NAME = /read[\s._-]?a(?:loud|long)/i;

function readAloudOf(item: Json): ReadAloudFile | null {
  const files: Json[] = Array.isArray(item?.libraryFiles) ? item.libraryFiles : [];
  const file = files.find((entry) => {
    const name = text(entry?.metadata?.filename);
    return /\.epub$/i.test(name) && READ_ALOUD_NAME.test(name) && text(entry?.ino) && number(entry?.metadata?.size) > 0;
  });
  return file ? { ino: text(file.ino), size: number(file.metadata.size), modified: number(file.metadata.mtimeMs) } : null;
}

/** A book in a list: no tracks or chapters. */
export interface BookSummary {
  id: string;
  libraryId: string;
  title: string;
  author: string;
  seriesName: string | null;
  duration: number;
  numChapters: number;
}

export interface BookProgress {
  /** Seconds into the book. */
  currentTime: number;
  duration: number;
  /** 0 to 1. */
  progress: number;
  isFinished: boolean;
  /** Milliseconds since the epoch. */
  lastUpdate: number;
}

export interface BookLibrary { id: string; name: string }

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

type Json = Record<string, any>;

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isBookId = (value: unknown): value is string => typeof value === "string" && ITEM_ID.test(value);

function seriesOf(metadata: Json): BookSeries[] {
  const raw = metadata?.series;
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return list.filter((entry) => entry && text(entry.id) && text(entry.name))
    .map((entry) => ({ id: text(entry.id), name: text(entry.name), sequence: text(entry.sequence) || null }));
}

function authorOf(metadata: Json): string {
  if (text(metadata?.authorName)) return text(metadata.authorName);
  return Array.isArray(metadata?.authors) ? metadata.authors.map((author: Json) => text(author?.name)).filter(Boolean).join(", ") : "";
}

/** A library item from GET /api/items/:id?expanded=1. Null for anything that isn't a book with audio. */
export function parseBook(item: Json): Book | null {
  const media = item?.media;
  if (!isBookId(item?.id) || item?.mediaType !== "book" || !media) return null;
  const metadata = media.metadata ?? {};
  // `tracks` is the play order with start offsets; older servers give only audioFiles.
  const source: Json[] = Array.isArray(media.tracks) && media.tracks.length
    ? media.tracks
    : (Array.isArray(media.audioFiles) ? media.audioFiles : []).filter((file: Json) => !file?.exclude).sort((a: Json, b: Json) => number(a.index) - number(b.index));
  let start = 0;
  const tracks: BookTrack[] = [];
  for (const file of source) {
    const ino = text(file?.ino);
    const duration = number(file?.duration);
    if (!ino || !(duration > 0)) continue;
    tracks.push({ index: tracks.length, ino, startOffset: start, duration, codec: text(file.codec).toLowerCase(), mimeType: text(file.mimeType) || "audio/mpeg" });
    start += duration;
  }
  if (!tracks.length) return null;
  const duration = number(media.duration) || start;
  const chapters = (Array.isArray(media.chapters) ? media.chapters : [])
    .map((chapter: Json) => ({ start: Math.max(0, number(chapter?.start)), end: number(chapter?.end), title: text(chapter?.title) }))
    .filter((chapter: BookChapter) => chapter.end > chapter.start)
    .sort((a: BookChapter, b: BookChapter) => a.start - b.start);
  return {
    id: item.id,
    libraryId: text(item.libraryId),
    title: text(metadata.title) || "Untitled",
    subtitle: text(metadata.subtitle) || null,
    author: authorOf(metadata),
    narrator: text(metadata.narratorName) || (Array.isArray(metadata.narrators) ? metadata.narrators.join(", ") : "") || null,
    series: seriesOf(metadata),
    duration,
    tracks,
    chapters,
    readAloud: readAloudOf(item),
  };
}

/** A library item from a list (minified or not). Null for a podcast or anything without audio. */
export function parseBookSummary(item: Json): BookSummary | null {
  const media = item?.media;
  if (!isBookId(item?.id) || item?.mediaType !== "book" || !media) return null;
  const tracks = number(media.numTracks ?? media.numAudioFiles ?? (Array.isArray(media.tracks) ? media.tracks.length : 0));
  if (!tracks && !(number(media.duration) > 0)) return null;
  const metadata = media.metadata ?? {};
  const seriesName = text(metadata.seriesName) || seriesOf(metadata).map((series) => series.sequence ? `${series.name} #${series.sequence}` : series.name).join(", ");
  return {
    id: item.id,
    libraryId: text(item.libraryId),
    title: text(metadata.title) || "Untitled",
    author: authorOf(metadata),
    seriesName: seriesName || null,
    duration: number(media.duration),
    numChapters: number(media.numChapters ?? (Array.isArray(media.chapters) ? media.chapters.length : 0)),
  };
}

export function parseProgress(value: Json | null): BookProgress | null {
  if (!value || typeof value !== "object") return null;
  return {
    currentTime: Math.max(0, number(value.currentTime)),
    duration: number(value.duration),
    progress: Math.min(1, Math.max(0, number(value.progress))),
    isFinished: value.isFinished === true,
    lastUpdate: number(value.lastUpdate),
  };
}

/** A filter value as Audiobookshelf's own web client encodes one: base64, then URI-encoded. */
export const filterValue = (value: string) => encodeURIComponent(Buffer.from(value).toString("base64"));

export interface AudiobookshelfSearch {
  books: BookSummary[];
  authors: { id: string; name: string }[];
  series: { id: string; name: string; books: BookSummary[] }[];
}

/** Audiobookshelf's REST API, as far as Hoban Books uses it. */
export function createAudiobookshelfClient(config: AudiobookshelfConfig, fetcher: Fetch = fetch, timeoutMs = 8000) {
  const headers = { Authorization: `Bearer ${config.apiKey}` };

  async function call<T>(method: "GET" | "PATCH" | "POST", path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(`${config.url}${path}`, {
        method,
        headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new AudiobookshelfError(`Audiobookshelf is unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status === 401 || response.status === 403) throw new AudiobookshelfError("Audiobookshelf refused the API key", response.status);
    if (response.status === 404) throw new AudiobookshelfError("Audiobookshelf has no such item", 404);
    if (!response.ok) throw new AudiobookshelfError(`Audiobookshelf answered ${response.status}`, response.status);
    const type = response.headers.get("content-type") ?? "";
    return (type.includes("json") ? await response.json().catch(() => null) : null) as T;
  }

  const bookLibraries = async (): Promise<BookLibrary[]> => {
    const answer = await call<{ libraries?: Json[] }>("GET", "/api/libraries");
    return (answer?.libraries ?? []).filter((library) => library?.mediaType === "book" && text(library.id))
      .map((library) => ({ id: text(library.id), name: text(library.name) }));
  };

  return {
    bookLibraries,

    /** One page of a library's books, sorted by title, or by `sort` (an Audiobookshelf sort key). */
    async libraryBooks(libraryId: string, options: { page?: number; limit?: number; filter?: string; sort?: string; desc?: boolean } = {}): Promise<{ books: BookSummary[]; total: number }> {
      const query = new URLSearchParams({
        limit: String(options.limit ?? 50), page: String(options.page ?? 0), sort: options.sort ?? "media.metadata.title", minified: "1",
        ...(options.desc ? { desc: "1" } : {}),
      });
      const filter = options.filter ? `&filter=${options.filter}` : "";
      const answer = await call<{ results?: Json[]; total?: number }>("GET", `/api/libraries/${encodeURIComponent(libraryId)}/items?${query}${filter}`);
      const books = (answer?.results ?? []).map(parseBookSummary).filter((book): book is BookSummary => book !== null);
      return { books, total: number(answer?.total) || books.length };
    },

    async search(libraryId: string, query: string, limit = 12): Promise<AudiobookshelfSearch> {
      const answer = await call<Json>("GET", `/api/libraries/${encodeURIComponent(libraryId)}/search?${new URLSearchParams({ q: query, limit: String(limit) })}`);
      const summaries = (list: unknown) => (Array.isArray(list) ? list : []).map((entry: Json) => parseBookSummary(entry?.libraryItem ?? entry)).filter((book): book is BookSummary => book !== null);
      return {
        books: summaries(answer?.book),
        authors: (Array.isArray(answer?.authors) ? answer.authors : []).filter((author: Json) => text(author?.id) && text(author?.name))
          .map((author: Json) => ({ id: text(author.id), name: text(author.name) })),
        series: (Array.isArray(answer?.series) ? answer.series : []).filter((entry: Json) => text(entry?.series?.id))
          .map((entry: Json) => ({ id: text(entry.series.id), name: text(entry.series.name), books: summaries(entry.books) })),
      };
    },

    async book(itemId: string): Promise<Book | null> {
      if (!isBookId(itemId)) return null;
      try {
        return parseBook(await call<Json>("GET", `/api/items/${itemId}?expanded=1`));
      } catch (error) {
        if (error instanceof AudiobookshelfError && error.status === 404) return null;
        throw error;
      }
    },

    /** Books the user is part way through, most recently listened first. */
    async inProgress(limit = 25): Promise<(BookSummary & { lastUpdate: number })[]> {
      const answer = await call<{ libraryItems?: Json[] }>("GET", `/api/me/items-in-progress?limit=${limit}`);
      return (answer?.libraryItems ?? []).flatMap((item) => {
        const book = item?.recentEpisode ? null : parseBookSummary(item);
        return book ? [{ ...book, lastUpdate: number(item.progressLastUpdate) }] : [];
      });
    },

    /** Every saved progress of the user's, by item ID. */
    async allProgress(): Promise<Map<string, BookProgress>> {
      const answer = await call<Json[] | null>("GET", "/api/me/progress");
      const list = Array.isArray(answer) ? answer : [];
      return new Map(list.filter((entry) => isBookId(entry?.libraryItemId) && !entry.episodeId)
        .map((entry) => [entry.libraryItemId as string, parseProgress(entry)!]));
    },

    async progress(itemId: string): Promise<BookProgress | null> {
      if (!isBookId(itemId)) return null;
      try {
        return parseProgress(await call<Json>("GET", `/api/me/progress/${itemId}`));
      } catch (error) {
        if (error instanceof AudiobookshelfError && error.status === 404) return null;
        throw error;
      }
    },

    /** Saves where the user is (PATCH /api/me/progress/:id), as the phone app does between sessions. */
    async saveProgress(itemId: string, update: { currentTime: number; duration: number } | { isFinished: boolean }): Promise<void> {
      if (!isBookId(itemId)) throw new AudiobookshelfError("not a book ID");
      const body = "currentTime" in update
        ? { currentTime: Math.max(0, update.currentTime), duration: update.duration, progress: update.duration > 0 ? Math.min(1, update.currentTime / update.duration) : 0 }
        : { isFinished: update.isFinished };
      await call("PATCH", `/api/me/progress/${itemId}`, body);
    },

    /** The book's cover, passed through. */
    async cover(itemId: string, signal?: AbortSignal): Promise<Response> {
      if (!isBookId(itemId)) throw new AudiobookshelfError("not a book ID");
      return fetcher(`${config.url}/api/items/${itemId}/cover?width=600&format=jpeg`, { headers, signal });
    },

    /** Bytes `start` to `end` (inclusive) of one of the book's files. */
    async fileRange(itemId: string, ino: string, start: number, end: number): Promise<Uint8Array> {
      if (!isBookId(itemId) || !/^[A-Za-z0-9_-]{1,64}$/.test(ino)) throw new AudiobookshelfError("not a book file");
      let response: Response;
      try {
        response = await fetcher(`${config.url}/api/items/${itemId}/file/${ino}`, {
          headers: { ...headers, Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(timeoutMs * 4),
        });
      } catch (error) {
        throw new AudiobookshelfError(`Audiobookshelf is unreachable: ${error instanceof Error ? error.message : String(error)}`);
      }
      // Only a partial answer: a server ignoring the range would send the whole file, a gigabyte of audio.
      if (response.status !== 206) {
        await response.body?.cancel().catch(() => {});
        throw new AudiobookshelfError(`Audiobookshelf answered ${response.status} to a range request`, response.status);
      }
      return new Uint8Array(await response.arrayBuffer());
    },

    /** Where one audio file is, with the header that opens it, for ffmpeg to read with ranges. Never logged. */
    fileSource(itemId: string, ino: string): { url: string; headers: Record<string, string> } {
      return { url: `${config.url}/api/items/${encodeURIComponent(itemId)}/file/${encodeURIComponent(ino)}`, headers };
    },
  };
}

export type AudiobookshelfClient = ReturnType<typeof createAudiobookshelfClient>;

let defaultClient: { key: string; client: AudiobookshelfClient } | null = null;

/** The server's client, or why there is none. */
export function defaultAudiobookshelf(): AudiobookshelfClient | { disabled: string } {
  const config = audiobookshelfConfig();
  if ("disabled" in config) return config;
  const key = `${config.url}\n${config.apiKey}`;
  if (defaultClient?.key !== key) defaultClient = { key, client: createAudiobookshelfClient(config) };
  return defaultClient.client;
}
