import type { Context, Hono } from "hono";
import { ffmpegStreamResponse, type SpawnFfmpeg } from "../alexa/alexaBookAudio";
import type { AlexaConfig } from "../alexa/alexaConfig";
import { alexaMovieAudioLink, alexaMoviePosterLink, movieStreamArgs, verifyAlexaMovieAudioLink, verifyAlexaMoviePosterLink } from "../alexa/alexaMovieAudio";
import { createMovieProgressSync, type MovieProgressSync } from "../alexa/alexaMovieProgressSync";
import { createAlexaMovieSkill, decodeMovieToken, encodeMovieToken, movieSubtitle, type AlexaMovieSkill, type MovieApi } from "../alexa/alexaMovieSkill";
import type { NowPlayingItem } from "../alexa/alexaNowPlaying";
import type { AlexaRoomStore } from "../alexa/alexaRooms";
import { log } from "../logger";
import { chooseAudioStream, defaultPlex, type PlexClient } from "../plex/plexClient";

export interface AlexaMovieRouteDependencies {
  /** Plex, or why it isn't there. */
  plex?: () => (MovieApi & Pick<PlexClient, "image" | "fileSource">) | { disabled: string };
  spawn?: SpawnFfmpeg;
  /** Saves playing titles' places and notices dropped streams; see alexaMovieProgressSync.ts. */
  sync?: MovieProgressSync;
}

/**
 * Hoban Movies on the /alexa router: the skill, its signed audio links (a
 * title's soundtrack from a given place, through ffmpeg; see
 * alexaMovieAudio.ts) and posters. Neither Plex's address nor its token
 * reaches the Echo.
 */
export function createAlexaMovieRoutes(dependencies: AlexaMovieRouteDependencies & {
  enabled: () => AlexaConfig | null;
  rooms: AlexaRoomStore;
  isChild: (userId: number) => Promise<boolean>;
  now: () => number;
}) {
  const plex = dependencies.plex ?? defaultPlex;
  const { rooms } = dependencies;
  let skill: AlexaMovieSkill | null = null;

  const skillFor = (settings: AlexaConfig): AlexaMovieSkill => skill ??= createAlexaMovieSkill({
    plex,
    audioLink: (itemId, userId, startSeconds) => alexaMovieAudioLink(settings.publicUrl, settings.secret, itemId, userId, startSeconds, dependencies.now()),
    posterLink: (itemId) => alexaMoviePosterLink(settings.publicUrl, settings.secret, itemId),
    now: dependencies.now,
  });

  const sync = dependencies.sync ?? createMovieProgressSync({
    playing: () => rooms.playingEverywhere("movies"),
    nowPlaying: (userId, deviceId) => rooms.nowPlaying(userId, "movies", deviceId),
    saveNowPlaying: (userId, deviceId, record) => rooms.saveNowPlaying(userId, "movies", deviceId, record),
    save: async (itemId, position) => {
      const settings = dependencies.enabled();
      if (settings) await skillFor(settings).saveEstimate(itemId, position);
    },
    now: dependencies.now,
  });

  /** What a movie stream is, for now playing. */
  const describe = async (settings: AlexaConfig, token: string): Promise<{ videoId: string; item: NowPlayingItem } | null> => {
    const itemId = decodeMovieToken(token);
    const found = itemId ? await skillFor(settings).item(itemId).catch(() => null) : null;
    if (!found) return null;
    return { videoId: found.id, item: { title: found.title, artist: movieSubtitle(found), art: alexaMoviePosterLink(settings.publicUrl, settings.secret, found.id), durationMs: Math.round(found.duration * 1000) } };
  };

  function register(router: Hono): void {
    const audio = async (context: Context) => {
      const settings = dependencies.enabled();
      if (!settings) return context.json({ error: "not found" }, 404);
      const itemId = context.req.param("id") ?? "";
      const query = new URL(context.req.url).searchParams;
      const startedAt = dependencies.now();
      const fail = (status: 403 | 404 | 503, reason: string) => {
        log.warn("alexa.audio_failed", { skill: "movies", itemId, method: context.req.method, status, reason });
        return context.json({ error: status === 403 ? "invalid link" : "not found" }, status);
      };
      const userId = verifyAlexaMovieAudioLink(settings.secret, itemId, query, dependencies.now());
      if (!userId) return fail(403, "invalid or expired link");
      if (await dependencies.isChild(userId)) return fail(404, "child profile");
      const client = plex();
      if ("disabled" in client) return fail(503, client.disabled);
      const found = await skillFor(settings).item(itemId).catch(() => null);
      if (!found) return fail(404, "title not in Plex");
      if (context.req.method === "HEAD") return new Response(null, { headers: { "Content-Type": "audio/mp4", "Cache-Control": "no-store" } });
      const start = Math.min(Math.max(0, Number(query.get("t")) || 0), Math.max(0, found.duration - 1));
      const stream = chooseAudioStream(found.audio);
      const token = encodeMovieToken(itemId);
      sync.start();
      sync.opened(userId, token);
      const onClose = ({ ended, bytes }: { ended: boolean; bytes: number }) => {
        log.info("alexa.audio_closed", { skill: "movies", itemId, ended, bytes, seconds: Math.round((dependencies.now() - startedAt) / 1000) });
        if (!ended) void sync.dropped(userId, token);
      };
      const { response, error } = await ffmpegStreamResponse(movieStreamArgs(client.fileSource(found.partKey), stream, start), context.req.raw.signal, dependencies.spawn, onClose);
      const fields = { skill: "movies", itemId, codec: stream?.codec ?? null, channels: stream?.channels ?? null, start, status: response.status, ms: dependencies.now() - startedAt };
      if (error) log.warn("alexa.audio_failed", { ...fields, reason: error });
      else log.info("alexa.audio", fields);
      return response;
    };
    router.get("/movie-audio/:id", audio);

    router.get("/movie-poster/:id", async (context) => {
      const settings = dependencies.enabled();
      if (!settings) return context.json({ error: "not found" }, 404);
      const itemId = context.req.param("id");
      if (!verifyAlexaMoviePosterLink(settings.secret, itemId, new URL(context.req.url).searchParams)) return context.json({ error: "invalid link" }, 403);
      const client = plex();
      if ("disabled" in client) return context.json({ error: "not found" }, 404);
      const found = await skillFor(settings).item(itemId).catch(() => null);
      const upstream = found?.thumb ? await client.image(found.thumb, context.req.raw.signal).catch(() => null) : null;
      if (!upstream?.ok || !upstream.body) return context.json({ error: "not found" }, 404);
      return new Response(upstream.body, { headers: { "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "public, max-age=86400" } });
    });
  }

  return { skillFor, describe, register, sync };
}
