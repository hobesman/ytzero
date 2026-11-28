import type { Context, Hono } from "hono";
import {
  alexaBookAudioLink, alexaBookCoverLink, bookStreamResponse, verifyAlexaBookAudioLink, verifyAlexaBookCoverLink, type SpawnFfmpeg,
} from "../alexa/alexaBookAudio";
import { createBookProgressSync, type BookProgressSync } from "../alexa/alexaBookProgressSync";
import { createAlexaBookSkill, decodeBookToken, encodeBookToken, type AlexaBookSkill, type BookApi } from "../alexa/alexaBookSkill";
import type { AlexaConfig } from "../alexa/alexaConfig";
import type { NowPlayingItem } from "../alexa/alexaNowPlaying";
import type { AlexaRoomStore } from "../alexa/alexaRooms";
import { createAlexaRoomBooks, type AlexaRoomBooks } from "../alexa/alexaRoomBooks";
import { defaultAudiobookshelf, type AudiobookshelfClient } from "../audiobookshelf/audiobookshelfClient";
import { log } from "../logger";

export interface AlexaBookRouteDependencies {
  /** Audiobookshelf, or why it isn't there. */
  audiobookshelf?: () => (BookApi & Pick<AudiobookshelfClient, "cover" | "fileSource">) | { disabled: string };
  roomBooks?: AlexaRoomBooks;
  spawn?: SpawnFfmpeg;
  /** Saves playing books' places and notices dropped streams; see alexaBookProgressSync.ts. */
  sync?: BookProgressSync;
}

/**
 * Hoban Books on the /alexa router: the skill, its signed audio links (one
 * file of a book from a given place, through ffmpeg; see alexaBookAudio.ts)
 * and covers. Neither Audiobookshelf's address nor its key reaches the Echo.
 */
export function createAlexaBookRoutes(dependencies: AlexaBookRouteDependencies & {
  enabled: () => AlexaConfig | null;
  rooms: AlexaRoomStore;
  isChild: (userId: number) => Promise<boolean>;
  now: () => number;
}) {
  const audiobookshelf = dependencies.audiobookshelf ?? defaultAudiobookshelf;
  const roomBooks = dependencies.roomBooks ?? createAlexaRoomBooks();
  let skill: AlexaBookSkill | null = null;
  const { rooms } = dependencies;
  const sync = dependencies.sync ?? createBookProgressSync({
    playing: () => rooms.playingEverywhere("books"),
    nowPlaying: (userId, deviceId) => rooms.nowPlaying(userId, "books", deviceId),
    saveNowPlaying: (userId, deviceId, record) => rooms.saveNowPlaying(userId, "books", deviceId, record),
    book: async (bookId) => {
      const settings = dependencies.enabled();
      return settings ? skillFor(settings).book(bookId) : null;
    },
    saveProgress: async (bookId, update) => {
      const client = audiobookshelf();
      if ("disabled" in client) throw new Error(client.disabled);
      await client.saveProgress(bookId, update);
    },
    now: dependencies.now,
  });

  const skillFor = (settings: AlexaConfig): AlexaBookSkill => skill ??= createAlexaBookSkill({
    books: audiobookshelf,
    audioLink: (bookId, fileIndex, userId, startSeconds) => alexaBookAudioLink(settings.publicUrl, settings.secret, bookId, fileIndex, userId, startSeconds, dependencies.now()),
    coverLink: (bookId) => alexaBookCoverLink(settings.publicUrl, settings.secret, bookId),
    roomBook: async (userId, deviceId) => {
      const room = await dependencies.rooms.room(userId, "books", deviceId);
      return { room, book: room ? await roomBooks.get(userId, room) : null };
    },
    now: dependencies.now,
  });

  /** What a book stream is, for now playing: the file's length, since the Echo reports places in the file. */
  const describe = async (settings: AlexaConfig, token: string): Promise<{ videoId: string; item: NowPlayingItem } | null> => {
    const decoded = decodeBookToken(token);
    const book = decoded ? await skillFor(settings).book(decoded.bookId).catch(() => null) : null;
    const track = decoded && book?.tracks[decoded.fileIndex];
    if (!book || !track) return null;
    return { videoId: book.id, item: { title: book.title, artist: book.author, art: alexaBookCoverLink(settings.publicUrl, settings.secret, book.id), durationMs: Math.round(track.duration * 1000) } };
  };

  function register(router: Hono): void {
    const audio = async (context: Context) => {
      const settings = dependencies.enabled();
      if (!settings) return context.json({ error: "not found" }, 404);
      const bookId = context.req.param("id") ?? "";
      const fileIndex = Number(context.req.param("index"));
      const query = new URL(context.req.url).searchParams;
      const startedAt = dependencies.now();
      const fail = (status: 403 | 404 | 502 | 503, reason: string) => {
        log.warn("alexa.audio_failed", { skill: "books", bookId, fileIndex, method: context.req.method, status, reason });
        return context.json({ error: status === 403 ? "invalid link" : "not found" }, status);
      };
      const userId = verifyAlexaBookAudioLink(settings.secret, bookId, fileIndex, query, dependencies.now());
      if (!userId) return fail(403, "invalid or expired link");
      if (await dependencies.isChild(userId)) return fail(404, "child profile");
      const client = audiobookshelf();
      if ("disabled" in client) return fail(503, client.disabled);
      const book = await skillFor(settings).book(bookId).catch(() => null);
      const track = book?.tracks[fileIndex];
      if (!book || !track) return fail(404, "book or file not in Audiobookshelf");
      if (context.req.method === "HEAD") return new Response(null, { headers: { "Content-Type": "audio/mp4", "Cache-Control": "no-store" } });
      const start = Math.min(Math.max(0, Number(query.get("t")) || 0), Math.max(0, track.duration - 1));
      const token = encodeBookToken(bookId, fileIndex);
      sync.start();
      sync.opened(userId, token);
      const onClose = ({ ended, bytes }: { ended: boolean; bytes: number }) => {
        log.info("alexa.audio_closed", { skill: "books", bookId, fileIndex, ended, bytes, seconds: Math.round((dependencies.now() - startedAt) / 1000) });
        if (!ended) void sync.dropped(userId, token);
      };
      const { response, error } = await bookStreamResponse(client.fileSource(bookId, track.ino), track.codec, start, context.req.raw.signal, dependencies.spawn, onClose);
      const fields = { skill: "books", bookId, fileIndex, codec: track.codec, start, range: context.req.header("range") ?? null, status: response.status, ms: dependencies.now() - startedAt };
      if (error) log.warn("alexa.audio_failed", { ...fields, reason: error });
      else log.info("alexa.audio", fields);
      return response;
    };
    router.get("/book-audio/:id/:index", audio);

    router.get("/book-cover/:id", async (context) => {
      const settings = dependencies.enabled();
      if (!settings) return context.json({ error: "not found" }, 404);
      const bookId = context.req.param("id");
      if (!verifyAlexaBookCoverLink(settings.secret, bookId, new URL(context.req.url).searchParams)) return context.json({ error: "invalid link" }, 403);
      const client = audiobookshelf();
      if ("disabled" in client) return context.json({ error: "not found" }, 404);
      const upstream = await client.cover(bookId, context.req.raw.signal).catch(() => null);
      if (!upstream?.ok || !upstream.body) return context.json({ error: "not found" }, 404);
      return new Response(upstream.body, { headers: { "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "public, max-age=86400" } });
    });
  }

  return { skillFor, describe, register, sync };
}
