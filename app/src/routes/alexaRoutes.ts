import { Hono, type Context } from "hono";
import { createAlexaRoomHistory, type AlexaRoomHistory } from "../alexa/alexaRoomHistory";
import { alexaAudioLink, alexaAudioPath, alexaPlaylist, alexaPlaylistLink, verifyAlexaAudioLink, type AlexaAudioKind } from "../alexa/alexaAudioLinks";
import { followChannelForAlexa, searchChannelsForAlexa, unfollowChannelForAlexa } from "../alexa/alexaChannelFollow";
import { findGenrePlaylist } from "../alexa/alexaGenreMatch";
import { alexaConfig, resolveAlexaProfile, type AlexaConfig } from "../alexa/alexaConfig";
import { speak, type AlexaResponse } from "../alexa/alexaPlayback";
import { describeAlexaExchange } from "../alexa/alexaLogging";
import { envelopeWithoutStreamStarts, responseWithStreamStarts } from "../alexa/alexaStreamTokens";
import { decodePlaybackToken } from "../alexa/alexaPlayback";
import { answerRoomIntent, trackDevice, type NowPlayingTracking } from "../alexa/alexaRoomIntents";
import { createAlexaRoomStore, type AlexaRoomStore } from "../alexa/alexaRooms";
import { createAlexaRoomSettings, type AlexaRoomSettings } from "../alexa/alexaRoomSettings";
import type { AlexaQueueSource } from "../alexa/alexaQueue";
import { decodeVideoToken } from "../alexa/alexaVideoSkill";
import { createAlexaSignatureVerifier, type AlexaSignatureVerifier } from "../alexa/alexaSignature";
import { createAlexaSkill, envelopeSkillId, type AlexaEnvelope, type AlexaSkillDependencies } from "../alexa/alexaSkill";
import {
  alexaVideo, channelVideos, followedChannels, lastUnfinishedVideo, recordVideoFinished, recordVideoProgress, recordVideoStarted,
} from "../alexa/alexaVideoCatalog";
import { createAlexaVideoSkill, type AlexaVideoSkillDependencies } from "../alexa/alexaVideoSkill";
import { parseAudioRange } from "../audioRange";
import { isChildUser } from "../childTime";
import { log } from "../logger";
import { createMusicPages } from "../music/musicAlbums";
import type { MusicAudio } from "../music/musicAudio";
import { musicTrack } from "../music/musicCatalog";
import { recordMusicPlay } from "../music/musicPlays";
import { createMusicStations } from "../music/musicStation";
import { createYouTubeMusicClient } from "../music/youtubeMusicClient";
import { defaultMusicAudio } from "./musicRoutes";
import { wholeAudioResponse } from "../alexa/alexaWholeAudio";
import { playlistSegmentStart, trimPlaylist } from "../alexa/alexaPlaylistTrim";
import type { AudioVodPlaylistResult } from "../downloadAudioVodStreaming";
import { createAlexaBookRoutes, type AlexaBookRouteDependencies } from "./alexaBookRoutes";
import { UNCHANGED, type AlexaAudioPlans } from "../alexa/alexaAudioPlan";
import { envelopeInVideoTime, responseInEchoTime } from "../alexa/alexaAudioTimeline";
import { alexaInternalAudioLink, alexaProcessedAudioLink, processedStreamArgs } from "../alexa/alexaProcessedAudio";
import { ffmpegStreamResponse, type SpawnFfmpeg } from "../alexa/alexaBookAudio";
import { createMusicAlbumArt, type MusicAlbumArt } from "../music/musicAlbumArt";

const MAX_REQUEST_BYTES = 64 * 1024;
/** How long a play waits to learn where its playlist starts. */
const STREAM_START_WAIT_MS = 4_000;

type Handler = { handle: (userId: number, envelope: AlexaEnvelope) => Promise<AlexaResponse> };

export interface AlexaRouteDependencies {
  config?: () => AlexaConfig | { disabled: string };
  verifier?: Pick<AlexaSignatureVerifier, "check">;
  resolveProfile?: (profile: string) => Promise<number | null>;
  isChild?: (userId: number) => Promise<boolean>;
  audio?: () => Promise<{ audio: MusicAudio; ytdlpAvailable: () => Promise<boolean> }>;
  skill?: Partial<AlexaSkillDependencies>;
  videoSkill?: Partial<AlexaVideoSkillDependencies>;
  /** Whether a video's audio may be served; the default reads the catalog. */
  videoPlayable?: (userId: number, videoId: string) => Promise<boolean>;
  /** A video's audio as an HLS playlist over the audio route; the default is the app's own. */
  vodPlaylist?: (userId: number, videoId: string, signal?: AbortSignal) => Promise<AudioVodPlaylistResult>;
  /** Devices, their rooms and what each is playing. */
  rooms?: AlexaRoomStore;
  /** Rooms' Home Assistant entities and saved queues. */
  roomSettings?: AlexaRoomSettings;
  describeStream?: NowPlayingTracking["describe"];
  /** Each room's recent plays. */
  roomHistory?: AlexaRoomHistory;
  /** Hoban Books: Audiobookshelf, the rooms' queued books and ffmpeg. */
  books?: AlexaBookRouteDependencies;
  /**
   * SponsorBlock cuts and music levelling for each stream (see
   * alexaAudioPlan.ts). Without it nothing is processed: the server passes the
   * app's own plans.
   */
  audioPlans?: Pick<AlexaAudioPlans, "get" | "peek">;
  /** This server on its own port, where ffmpeg reads the audio it processes. */
  internalOrigin?: string;
  spawn?: SpawnFfmpeg;
  now?: () => number;
}

const NO_PLANS: Pick<AlexaAudioPlans, "get" | "peek"> = { get: async () => UNCHANGED, peek: () => UNCHANGED };

const seconds = (value: number | null | undefined) => value ? value * 1000 : null;

/** The video behind a stream token, with what the catalog says about it; a song with its album cover. */
const describeStream = (albumArt: MusicAlbumArt | null): NowPlayingTracking["describe"] => async (skill, userId, token) => {
  if (skill === "music") {
    const videoId = decodePlaybackToken(token)?.videoId;
    const track = videoId ? await musicTrack(videoId) : null;
    const art = track && albumArt ? await albumArt(userId, track) : track?.thumbnail ?? "";
    return track && { videoId: track.videoId, item: { title: track.title, artist: track.artist, art, durationMs: seconds(track.duration) } };
  }
  const videoId = decodeVideoToken(token);
  const video = videoId ? await alexaVideo(userId, videoId) : null;
  return video && { videoId: video.videoId, item: { title: video.title, artist: video.channelTitle, art: video.thumbnail, durationMs: seconds(video.duration) } };
};

/**
 * Two private Alexa skills, music and video, on one endpoint, told apart by
 * skill ID. It lives outside the authenticated API: Alexa sends no cookie, so
 * a skill request proves itself with Amazon's signature, and each audio link
 * with its own HMAC. Neither grants any other API access.
 */
export function createAlexaRouter(dependencies: AlexaRouteDependencies = {}): Hono {
  const router = new Hono();
  const config = dependencies.config ?? (() => alexaConfig());
  const now = dependencies.now ?? Date.now;
  const verifier = dependencies.verifier ?? createAlexaSignatureVerifier();
  const plans = dependencies.audioPlans ?? NO_PLANS;
  const internalOrigin = dependencies.internalOrigin ?? `http://127.0.0.1:${Number(process.env.PORT ?? 3001)}`;
  const resolveProfile = dependencies.resolveProfile ?? resolveAlexaProfile;
  const isChild = dependencies.isChild ?? isChildUser;
  const vodPlaylist = dependencies.vodPlaylist ?? (async (userId: number, videoId: string, signal?: AbortSignal) => (await import("../downloader")).getAudioVodPlaylist(userId, videoId, signal));
  /**
   * The start of the playlist segment holding a place. Waits only so long:
   * Alexa wants its answer within a few seconds, and a video not played lately
   * needs its audio looked up first. Then the place as is, and the playlist
   * still starts at the segment holding it.
   */
  const streamStart = async (userId: number, videoId: string, offsetSeconds: number): Promise<number> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STREAM_START_WAIT_MS);
    try {
      const result = await vodPlaylist(userId, videoId, controller.signal);
      // Audio that can't be indexed is served whole, from its start.
      return result.kind === "playlist" ? playlistSegmentStart(result.playlist, offsetSeconds) : result.kind === "unsupported" ? 0 : offsetSeconds;
    } catch {
      return offsetSeconds;
    } finally {
      clearTimeout(timer);
    }
  };
  const videoPlayable = dependencies.videoPlayable ?? (async (userId: number, videoId: string) => Boolean((await alexaVideo(userId, videoId))?.playable));
  let musicClient: ReturnType<typeof createYouTubeMusicClient> | null = null;
  const musicClientFor = () => musicClient ??= dependencies.skill?.client as ReturnType<typeof createYouTubeMusicClient> | undefined ?? createYouTubeMusicClient();
  const albumArt: MusicAlbumArt = dependencies.skill?.albumArt ?? createMusicAlbumArt({ search: (userId, query) => musicClientFor().searchSongs(userId, query) });
  const tracking: NowPlayingTracking = {
    rooms: dependencies.rooms ?? createAlexaRoomStore(),
    history: dependencies.roomHistory ?? createAlexaRoomHistory(),
    describe: dependencies.describeStream ?? (async (skill, userId, token) => {
      if (skill !== "books") return describeStream(albumArt)(skill, userId, token);
      const settings = enabled();
      return settings ? books.describe(settings, token) : null;
    }),
  };
  const roomSettings = dependencies.roomSettings ?? createAlexaRoomSettings();
  // The music skill sees its own device ID, so the room comes from its pairing.
  const queues: AlexaQueueSource = {
    forDevice: async (userId, deviceId) => {
      const room = await tracking.rooms.room(userId, "music", deviceId);
      return { room, queue: room ? await roomSettings.queue(userId, room) : null };
    },
    byId: (userId, queueId) => roomSettings.queueById(userId, queueId),
  };
  let audioDependencies: ReturnType<typeof defaultMusicAudio> | null = null;
  const audioService = dependencies.audio ?? (() => audioDependencies ??= defaultMusicAudio());
  const prepare = (userId: number, videoId: string) => {
    audioService()
      .then(async ({ audio, ytdlpAvailable }) => { if (await ytdlpAvailable()) await audio.prepare(userId, videoId); })
      .catch(() => {});
  };

  let musicSkill: Handler | null = null;
  const musicSkillFor = (settings: AlexaConfig): Handler => {
    if (musicSkill) return musicSkill;
    const client = musicClientFor();
    const pages = createMusicPages(client);
    return musicSkill = createAlexaSkill({
      client,
      stations: dependencies.skill?.stations ?? createMusicStations(client, pages),
      prepare: dependencies.skill?.prepare ?? prepare,
      audioLink: dependencies.skill?.audioLink ?? ((videoId, userId, startSeconds) => startSeconds
        ? alexaPlaylistLink(settings.publicUrl, settings.secret, videoId, userId, now(), startSeconds, "music")
        : alexaAudioLink(settings.publicUrl, settings.secret, videoId, userId, now(), "music")),
      streamStart: dependencies.skill?.streamStart ?? streamStart,
      recordPlay: dependencies.skill?.recordPlay ?? recordMusicPlay,
      findTrack: dependencies.skill?.findTrack,
      saveTracks: dependencies.skill?.saveTracks,
      queues: dependencies.skill?.queues ?? queues,
      albumArt,
      findGenre: dependencies.skill?.findGenre ?? ((userId, spoken) => findGenrePlaylist({ genres: pages.genres, genre: pages.genre, searchPlaylists: client.searchPlaylists }, userId, spoken)),
    });
  };

  let videoSkill: Handler | null = null;
  const videoSkillFor = (settings: AlexaConfig): Handler => {
    if (videoSkill) return videoSkill;
    const given = dependencies.videoSkill ?? {};
    return videoSkill = createAlexaVideoSkill({
      followedChannels: given.followedChannels ?? followedChannels,
      channelVideos: given.channelVideos ?? channelVideos,
      findVideo: given.findVideo ?? alexaVideo,
      search: given.search ?? (async (userId, query) => (await (await import("../youtube")).searchYouTube(query, userId)).results),
      importVideo: given.importVideo ?? (async (userId, videoId) => (await import("../onDemandVideoImport")).ensureOnDemandVideo(videoId, userId)),
      // Always a playlist: see alexaPlaylistLink.
      audioLink: given.audioLink ?? ((videoId, userId, startSeconds) => alexaPlaylistLink(settings.publicUrl, settings.secret, videoId, userId, now(), startSeconds)),
      streamStart: given.streamStart ?? ((userId, videoId, offsetSeconds) => streamStart(userId, videoId, offsetSeconds)),
      prepare: given.prepare ?? prepare,
      recordStarted: given.recordStarted ?? recordVideoStarted,
      recordProgress: given.recordProgress ?? recordVideoProgress,
      recordFinished: given.recordFinished ?? recordVideoFinished,
      resumeCandidates: given.resumeCandidates ?? (async (userId, deviceId) => {
        const onDevice = deviceId ? (await tracking.rooms.nowPlaying(userId, "video", deviceId))?.videoId : null;
        const latest = await lastUnfinishedVideo(userId);
        return [...new Set([onDevice, latest].filter((id): id is string => Boolean(id)))];
      }),
      channels: given.channels ?? { searchChannels: searchChannelsForAlexa, followedChannels, follow: followChannelForAlexa, unfollow: unfollowChannelForAlexa },
    });
  };

  const enabled = () => {
    const settings = config();
    return "disabled" in settings ? null : settings;
  };
  const books = createAlexaBookRoutes({ ...dependencies.books, enabled, rooms: tracking.rooms, isChild, now });

  router.post("/", async (context) => {
    const settings = enabled();
    if (!settings) return context.json({ error: "not found" }, 404);
    const length = Number(context.req.header("content-length") ?? 0);
    if (length > MAX_REQUEST_BYTES) return context.json({ error: "request too large" }, 413);
    const raw = await context.req.text();
    if (raw.length > MAX_REQUEST_BYTES) return context.json({ error: "request too large" }, 413);
    let envelope: AlexaEnvelope;
    try {
      envelope = JSON.parse(raw) as AlexaEnvelope;
    } catch {
      return context.json({ error: "invalid request" }, 400);
    }
    const refused = await verifier.check(context.req.raw.headers, raw, envelope?.request?.timestamp);
    if (refused) {
      log.warn("alexa.request_refused", { reason: refused });
      return context.json({ error: "invalid signature" }, 400);
    }
    const skillId = envelopeSkillId(envelope);
    const kind = !skillId ? null : skillId === settings.musicSkillId ? "music" : skillId === settings.videoSkillId ? "video" : skillId === settings.booksSkillId ? "books" : null;
    if (!kind) {
      log.warn("alexa.request_refused", { reason: "wrong skill" });
      return context.json({ error: "wrong skill" }, 400);
    }
    const userId = await resolveProfile(settings.profile);
    if (!userId) {
      log.warn("alexa.profile_missing", { profile: settings.profile });
      return context.json(speak("YT Zero can't find the profile this skill is set up to use."));
    }
    if (await isChild(userId)) return context.json(speak("This isn't available on this profile."));
    const skill = kind === "music" ? musicSkillFor(settings) : kind === "video" ? videoSkillFor(settings) : books.skillFor(settings);
    // Stream tokens carry their start for the Echo's sake only (see alexaStreamTokens.ts).
    const plain = envelopeWithoutStreamStarts(envelope);
    // The skills work in video time; the Echo, in the timeline of what it was sent (see alexaAudioTimeline.ts).
    const seen = kind === "books" ? plain : envelopeInVideoTime(plain, userId, kind, plans, kind === "music"
      ? (token) => decodePlaybackToken(token)?.videoId ?? null
      : (token) => decodeVideoToken(token));
    const response = await answerRoomIntent(tracking.rooms, userId, kind, seen, now()) ?? await skill.handle(userId, seen);
    await trackDevice(tracking, userId, kind, seen, response, now());
    const sent = responseWithStreamStarts(kind === "books" ? response : await responseInEchoTime(response, userId, kind, plans,
      (videoId, startSeconds) => alexaProcessedAudioLink(settings.publicUrl, settings.secret, videoId, userId, now(), startSeconds, kind)), envelope);
    log.info("alexa.request", describeAlexaExchange(kind, seen, sent));
    return context.json(sent);
  });

  const audioResponse = async (kind: AlexaAudioKind, context: Context, settings: AlexaConfig, videoId: string, playlist = false): Promise<{ response: Response; reason?: string }> => {
    const query = new URL(context.req.url).searchParams;
    const userId = verifyAlexaAudioLink(settings.secret, videoId, query, now(), kind);
    if (!userId) return { response: context.json({ error: "invalid link" }, 403), reason: "invalid or expired link" };
    if (await isChild(userId)) return { response: context.json({ error: "not found" }, 404), reason: "child profile" };
    const allowed = kind === "music" ? Boolean(await musicTrack(videoId)) : await videoPlayable(userId, videoId);
    if (!allowed) return { response: context.json({ error: "not found" }, 404), reason: kind === "music" ? "song not in the catalog" : "video not playable" };
    const range = context.req.header("range") ?? null;
    if (!parseAudioRange(range)) {
      return { response: new Response(null, { status: 416, headers: { "Accept-Ranges": "bytes", "Cache-Control": "no-store" } }), reason: "unsupported range" };
    }
    const { audio, ytdlpAvailable } = await audioService();
    if (!await ytdlpAvailable()) return { response: context.json({ error: "yt-dlp unavailable" }, 503), reason: "yt-dlp unavailable" };
    // The music audio service is the shared audio proxy plus a prefetched start,
    // and serves a video's audio track just the same.
    const signal = context.req.raw.signal;
    if (playlist && context.req.method === "GET") {
      const result = await vodPlaylist(userId, videoId, signal);
      if (result.kind === "playlist") {
        const fileQuery = new URLSearchParams(query);
        fileQuery.delete("t");
        const fileLink = `${settings.publicUrl}/alexa/${alexaAudioPath(kind)}/${videoId}?${fileQuery}`;
        const playlistText = trimPlaylist(result.playlist, Number(query.get("t")) || 0);
        return { response: new Response(alexaPlaylist(playlistText, videoId, fileLink), { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" } }) };
      }
      // Audio that can't be indexed still plays, from its start.
      log.warn("alexa.playlist_unavailable", { videoId, result: result.kind });
    }
    // ffmpeg reading for a processed stream: each range answered to the file's end.
    const from = query.get("whole") === "1" ? range?.match(/^bytes=(\d+)-$/)?.[1] : undefined;
    const response = context.req.method === "HEAD"
      ? await audio.head(userId, videoId, range, signal)
      : from !== undefined
        ? await wholeAudioResponse((piece) => audio.audio(userId, videoId, piece, signal), Number(from))
      // With no range, the Echo needs the whole file; see alexaWholeAudio.ts.
      : range == null
        ? await wholeAudioResponse((piece) => audio.audio(userId, videoId, piece, signal))
        : await audio.audio(userId, videoId, range, signal);
    return response ? { response } : { response: context.json({ error: "audio unavailable" }, 502), reason: "audio unavailable from YouTube" };
  };

  const serveAudio = (kind: AlexaAudioKind, playlist = false) => async (context: Context) => {
    const settings = enabled();
    if (!settings) return context.json({ error: "not found" }, 404);
    const videoId = context.req.param("id") ?? "";
    const startedAt = now();
    const { response, reason } = await audioResponse(kind, context, settings, videoId, playlist);
    const range = context.req.header("range") ?? null;
    const fields = { skill: kind, videoId, method: context.req.method, ...(playlist ? { playlist } : {}), range, status: response.status, ms: now() - startedAt };
    if (!response.ok) log.warn("alexa.audio_failed", { ...fields, reason });
    // Every request, so a seek (a range part way in) shows in the log.
    else log.info("alexa.audio", fields);
    return response;
  };
  /** A stream with its plan applied: cut and levelled by ffmpeg, from `t` video seconds (see alexaProcessedAudio.ts). */
  const serveProcessed = (kind: AlexaAudioKind) => async (context: Context) => {
    const settings = enabled();
    if (!settings) return context.json({ error: "not found" }, 404);
    const videoId = context.req.param("id") ?? "";
    const startedAt = now();
    const query = new URL(context.req.url).searchParams;
    const fields = { skill: kind, videoId, method: context.req.method, processed: true };
    const fail = (status: 403 | 404 | 502, reason: string) => {
      log.warn("alexa.audio_failed", { ...fields, status, reason });
      return context.json({ error: status === 403 ? "invalid link" : "not found" }, status);
    };
    const userId = verifyAlexaAudioLink(settings.secret, videoId, query, now(), kind);
    if (!userId) return fail(403, "invalid or expired link");
    if (await isChild(userId)) return fail(404, "child profile");
    const allowed = kind === "music" ? Boolean(await musicTrack(videoId)) : await videoPlayable(userId, videoId);
    if (!allowed) return fail(404, kind === "music" ? "song not in the catalog" : "video not playable");
    if (context.req.method === "HEAD") return new Response(null, { headers: { "Content-Type": "audio/mp4", "Cache-Control": "no-store" } });
    const plan = await plans.get(userId, kind, videoId);
    const start = Math.max(0, Number(query.get("t")) || 0);
    const input = alexaInternalAudioLink(internalOrigin, settings.secret, videoId, userId, now(), kind);
    const { response, error } = await ffmpegStreamResponse(processedStreamArgs(input, start, plan), context.req.raw.signal, dependencies.spawn);
    const done = { ...fields, start, cuts: plan.cuts.length, volumeDb: plan.volumeDb, status: response.status, ms: now() - startedAt };
    if (error) log.warn("alexa.audio_failed", { ...done, reason: error });
    else log.info("alexa.audio", done);
    return response;
  };
  router.get("/audio/:id/processed", serveProcessed("music"));
  router.get("/video-audio/:id/processed", serveProcessed("video"));
  router.get("/audio/:id", serveAudio("music"));
  // A song started part way in (a seek from the tablet), the way Hoban Tube starts every video.
  router.get("/audio/:id/index.m3u8", serveAudio("music", true));
  router.get("/video-audio/:id", serveAudio("video"));
  router.get("/video-audio/:id/index.m3u8", serveAudio("video", true));
  books.register(router);

  return router;
}
