import type { Context, Hono } from "hono";
import { parseAudioRange } from "../audioRange";
import { isChildUser } from "../childTime";
import { database } from "../database";
import { log } from "../logger";
import { createMusicPages } from "../music/musicAlbums";
import { createMusicAudio, type MusicAudio } from "../music/musicAudio";
import { musicTrack, musicTracks, upsertMusicTracks, type StoredMusicTrack } from "../music/musicCatalog";
import { mergeRecentWithEcho, recentMusicEchoPlays } from "../music/musicEchoPlays";
import { recordMusicPlay, type MusicPlayEndReason } from "../music/musicPlays";
import { upstreamFailure, withRatings, withTimeout } from "../music/musicRouteHelpers";
import { musicLoudness, type MusicLoudness } from "../music/musicLoudness";
import { savedAlbums } from "../music/musicSavedAlbums";
import { savedPlaylists, userPlaylists } from "../music/musicPlaylists";
import { createMusicStations, parseStationSeed, parseVideoIdList, stationSeedKey, type MusicStations } from "../music/musicStation";
import { createYouTubeMusicClient, type YouTubeMusicClient } from "../music/youtubeMusicClient";
import { registerAlexaRoomRoutes } from "./alexaRoomRoutes";
import { registerMusicAlbumRoutes } from "./musicAlbumRoutes";
import { registerMusicGenreRoutes } from "./musicGenreRoutes";
import { registerMusicLyricsRoutes } from "./musicLyricsRoutes";
import { createMusicLyrics, type MusicLyricsService } from "../music/musicLyrics";
import { registerMusicPlaylistRoutes } from "./musicPlaylistRoutes";

type ApiEnvironment = { Variables: { userId: number } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const END_REASONS = new Set(["completed", "skipped", "stopped"]);

export interface MusicRouteDependencies {
  currentUserId: (context: ApiContext) => number;
  client?: YouTubeMusicClient;
  audio?: MusicAudio;
  lyrics?: MusicLyricsService;
  ytdlpAvailable?: () => Promise<boolean>;
  loudness?: MusicLoudness;
}

export async function defaultMusicAudio(): Promise<{ audio: MusicAudio; ytdlpAvailable: () => Promise<boolean> }> {
  const downloader = await import("../downloader");
  return {
    audio: createMusicAudio({ getAudioResponse: downloader.getAudioResponse, getAudioHeadResponse: downloader.getAudioHeadResponse }),
    ytdlpAvailable: async () => Boolean(await downloader.ytdlpStatus()),
  };
}

/**
 * Music mode: a separate service on the shared server. These routes read and
 * write only the music_* tables and never the video catalog, watch history,
 * progress, subscriptions or video recommendations.
 */
export function registerMusicRoutes(api: Api, dependencies: MusicRouteDependencies): void {
  const { currentUserId } = dependencies;
  const client = dependencies.client ?? createYouTubeMusicClient();
  const loudness = dependencies.loudness ?? musicLoudness;
  const pages = createMusicPages(client);
  const stations: MusicStations = createMusicStations(client, pages);
  let audioDependencies: Promise<{ audio: MusicAudio; ytdlpAvailable: () => Promise<boolean> }> | null = null;
  const audioService = () => {
    if (dependencies.audio) return Promise.resolve({ audio: dependencies.audio, ytdlpAvailable: dependencies.ytdlpAvailable ?? (async () => true) });
    audioDependencies ??= defaultMusicAudio();
    return audioDependencies;
  };

  // A new station's first song has nothing prepared, and its audio address
  // takes a lookup plus a few seconds before YouTube serves it. Start that now,
  // while the phone is still setting up its player; the player's own request
  // joins the same lookup.
  const prepareInBackground = (userId: number, videoId: string) => {
    void audioService()
      .then(async ({ audio, ytdlpAvailable }) => { if (await ytdlpAvailable()) await audio.prepare(userId, videoId); })
      .catch(() => {});
  };

  api.use("/music/*", async (context, next) => {
    if (await isChildUser(currentUserId(context))) return context.json({ error: "not allowed" }, 403);
    await next();
  });

  api.get("/music/search", async (context) => {
    const userId = currentUserId(context);
    const query = (context.req.query("q") ?? "").trim().slice(0, 200);
    if (!query) return context.json({ tracks: [], albums: [], artists: [] });
    try {
      // Albums and artists come from a second search; songs still answer without them.
      const [songs, shelves] = await Promise.all([
        client.searchSongs(userId, query),
        client.searchAll(userId, query).catch((error) => {
          log.warn("music.search_shelves_failed", { error: error instanceof Error ? error.message : String(error) });
          return { albums: [], artists: [] };
        }),
      ]);
      const tracks = await upsertMusicTracks(songs);
      return context.json({ tracks: await withRatings(userId, tracks, loudness), albums: shelves.albums.slice(0, 12), artists: shelves.artists.slice(0, 8) });
    } catch (error) {
      return upstreamFailure(context, error, "music.search_failed");
    }
  });

  // Starts a station (nothing served yet) or continues one. The phone sends what
  // it already played, so a station survives a server restart.
  api.post("/music/station", async (context) => {
    const userId = currentUserId(context);
    const body = await context.req.json().catch(() => null) as Record<string, unknown> | null;
    const seed = parseStationSeed(body?.seed);
    if (!seed) return context.json({ error: "invalid seed" }, 400);
    const count = Math.min(25, Math.max(1, Math.floor(Number(body?.count) || 10)));
    try {
      const served = parseVideoIdList(body?.served);
      const tracks = await stations.next(userId, seed, served, parseVideoIdList(body?.skipped), count);
      if (!served.length && tracks[0]) prepareInBackground(userId, tracks[0].videoId);
      // The first song plays before the player could ask, so learn its loudness now.
      if (tracks[0]) await withTimeout(loudness.get(tracks[0].videoId), 2_000);
      return context.json({ seed: stationSeedKey(seed), tracks: await withRatings(userId, tracks, loudness) });
    } catch (error) {
      return upstreamFailure(context, error, "music.station_failed");
    }
  });

  api.get("/music/tracks/:id/audio", async (context) => {
    const userId = currentUserId(context);
    const videoId = context.req.param("id");
    if (!VIDEO_ID.test(videoId) || !await musicTrack(videoId)) return context.json({ error: "not found" }, 404);
    const range = context.req.header("range") ?? null;
    if (!parseAudioRange(range)) {
      return new Response(null, { status: 416, headers: { "Accept-Ranges": "bytes", "Cache-Control": "no-store" } });
    }
    const { audio, ytdlpAvailable } = await audioService();
    if (!await ytdlpAvailable()) return context.json({ error: "yt-dlp unavailable" }, 503);
    const response = context.req.method === "HEAD"
      ? await audio.head(userId, videoId, range, context.req.raw.signal)
      : await audio.audio(userId, videoId, range, context.req.raw.signal);
    return response ?? context.json({ error: "audio unavailable" }, 502);
  });

  api.post("/music/tracks/:id/prepare", async (context) => {
    const userId = currentUserId(context);
    const videoId = context.req.param("id");
    if (!VIDEO_ID.test(videoId) || !await musicTrack(videoId)) return context.json({ error: "not found" }, 404);
    const { audio, ytdlpAvailable } = await audioService();
    if (!await ytdlpAvailable()) return context.json({ error: "yt-dlp unavailable" }, 503);
    const [ready, loudnessDb] = await Promise.all([audio.prepare(userId, videoId), loudness.get(videoId)]);
    return context.json({ ready, loudnessDb });
  });

  api.post("/music/plays", async (context) => {
    const userId = currentUserId(context);
    const body = await context.req.json().catch(() => null) as Record<string, unknown> | null;
    const videoId = body?.videoId;
    const startedAt = typeof body?.startedAt === "string" ? new Date(body.startedAt) : null;
    const listened = Number(body?.listenedSeconds);
    const duration = body?.duration == null ? null : Number(body.duration);
    const endReason = body?.endReason;
    if (typeof videoId !== "string" || !VIDEO_ID.test(videoId) || !startedAt || Number.isNaN(startedAt.getTime())
      || !Number.isFinite(listened) || listened < 0 || (duration !== null && !Number.isFinite(duration))
      || typeof endReason !== "string" || !END_REASONS.has(endReason)) {
      return context.json({ error: "invalid play" }, 400);
    }
    if (!await musicTrack(videoId)) return context.json({ error: "not found" }, 404);
    const stationSeed = typeof body?.stationSeed === "string" ? body.stationSeed : null;
    await recordMusicPlay(userId, { videoId, startedAt, listenedSeconds: listened, duration, endReason: endReason as MusicPlayEndReason, stationSeed });
    return context.json({ ok: true });
  });

  api.put("/music/tracks/:id/rating", async (context) => {
    const userId = currentUserId(context);
    const videoId = context.req.param("id");
    const body = await context.req.json().catch(() => null) as { rating?: unknown } | null;
    const rating = Number(body?.rating);
    if (!VIDEO_ID.test(videoId) || ![1, 0, -1].includes(rating)) return context.json({ error: "invalid rating" }, 400);
    if (!await musicTrack(videoId)) return context.json({ error: "not found" }, 404);
    if (rating === 0) {
      await database.prepare("DELETE FROM music_ratings WHERE user_id = ? AND video_id = ?").run(userId, videoId);
    } else {
      await database.prepare(`
        INSERT INTO music_ratings (user_id, video_id, rating, rated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, video_id) DO UPDATE SET rating = excluded.rating, rated_at = excluded.rated_at
      `).run(userId, videoId, rating, new Date().toISOString());
    }
    return context.json({ ok: true, rating });
  });

  api.get("/music/library", async (context) => {
    const userId = currentUserId(context);
    const likedRows = await database.prepare("SELECT video_id FROM music_ratings WHERE user_id = ? AND rating = 1 ORDER BY rated_at DESC LIMIT 500")
      .all<{ video_id: string }>(userId);
    const recentRows = await database.prepare(`
      SELECT video_id, MAX(started_at) AS last_played FROM music_plays WHERE user_id = ?
      GROUP BY video_id ORDER BY last_played DESC LIMIT 50
    `).all<{ video_id: string; last_played: string }>(userId);
    const known = await musicTracks([...likedRows, ...recentRows].map((row) => row.video_id));
    const pick = (rows: { video_id: string }[]) => rows.map((row) => known.get(row.video_id)).filter((track): track is StoredMusicTrack => Boolean(track));
    const recent = await withRatings(userId, pick(recentRows), loudness);
    const lastPlayed = new Map(recentRows.map((row) => [row.video_id, row.last_played]));
    // Songs an Echo played through Amazon Music that matched no track, shown greyed out.
    const played = recent.map((track) => ({ track, lastPlayed: lastPlayed.get(track.videoId) ?? "", songKey: known.get(track.videoId)?.songKey ?? "" }));
    return context.json({
      liked: await withRatings(userId, pick(likedRows), loudness),
      recent: mergeRecentWithEcho(played, await recentMusicEchoPlays(userId)),
      albums: await savedAlbums(userId),
      playlists: await userPlaylists(userId),
      savedPlaylists: await savedPlaylists(userId),
    });
  });

  registerMusicAlbumRoutes(api, { currentUserId, pages });
  registerMusicGenreRoutes(api, { currentUserId, pages });
  registerMusicLyricsRoutes(api, { currentUserId, lyrics: dependencies.lyrics ?? createMusicLyrics({ client }) });
  registerMusicPlaylistRoutes(api, { currentUserId, pages });
  // The Echo rooms the Alexa skills play in. Registered here because routes.ts is at its size limit.
  registerAlexaRoomRoutes(api, { currentUserId });
}
