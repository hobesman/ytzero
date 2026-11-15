import { Hono, type Context } from "hono";
import { alexaAudioLink, verifyAlexaAudioLink, type AlexaAudioKind } from "../alexa/alexaAudioLinks";
import { findGenrePlaylist } from "../alexa/alexaGenreMatch";
import { alexaConfig, resolveAlexaProfile, type AlexaConfig } from "../alexa/alexaConfig";
import { speak, type AlexaResponse } from "../alexa/alexaPlayback";
import { describeAlexaExchange } from "../alexa/alexaLogging";
import { createAlexaSignatureVerifier, type AlexaSignatureVerifier } from "../alexa/alexaSignature";
import { createAlexaSkill, envelopeSkillId, type AlexaEnvelope, type AlexaSkillDependencies } from "../alexa/alexaSkill";
import {
  alexaVideo, channelVideos, followedChannels, recordVideoFinished, recordVideoProgress, recordVideoStarted,
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

const MAX_REQUEST_BYTES = 64 * 1024;

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
  now?: () => number;
}

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
  const resolveProfile = dependencies.resolveProfile ?? resolveAlexaProfile;
  const isChild = dependencies.isChild ?? isChildUser;
  const videoPlayable = dependencies.videoPlayable ?? (async (userId: number, videoId: string) => Boolean((await alexaVideo(userId, videoId))?.playable));
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
    const client = dependencies.skill?.client as ReturnType<typeof createYouTubeMusicClient> | undefined ?? createYouTubeMusicClient();
    const pages = createMusicPages(client);
    return musicSkill = createAlexaSkill({
      client,
      stations: dependencies.skill?.stations ?? createMusicStations(client, pages),
      prepare: dependencies.skill?.prepare ?? prepare,
      audioLink: dependencies.skill?.audioLink ?? ((videoId, userId) => alexaAudioLink(settings.publicUrl, settings.secret, videoId, userId, now(), "music")),
      recordPlay: dependencies.skill?.recordPlay ?? recordMusicPlay,
      findTrack: dependencies.skill?.findTrack,
      saveTracks: dependencies.skill?.saveTracks,
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
      audioLink: given.audioLink ?? ((videoId, userId) => alexaAudioLink(settings.publicUrl, settings.secret, videoId, userId, now(), "video")),
      prepare: given.prepare ?? prepare,
      recordStarted: given.recordStarted ?? recordVideoStarted,
      recordProgress: given.recordProgress ?? recordVideoProgress,
      recordFinished: given.recordFinished ?? recordVideoFinished,
    });
  };

  const enabled = () => {
    const settings = config();
    return "disabled" in settings ? null : settings;
  };

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
    const kind = skillId && skillId === settings.musicSkillId ? "music" : skillId && skillId === settings.videoSkillId ? "video" : null;
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
    const skill = kind === "music" ? musicSkillFor(settings) : videoSkillFor(settings);
    const response = await skill.handle(userId, envelope);
    log.info("alexa.request", describeAlexaExchange(kind, envelope, response));
    return context.json(response);
  });

  const audioResponse = async (kind: AlexaAudioKind, context: Context, settings: AlexaConfig, videoId: string): Promise<{ response: Response; reason?: string }> => {
    const userId = verifyAlexaAudioLink(settings.secret, videoId, new URL(context.req.url).searchParams, now(), kind);
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
    const response = context.req.method === "HEAD"
      ? await audio.head(userId, videoId, range, context.req.raw.signal)
      : await audio.audio(userId, videoId, range, context.req.raw.signal);
    return response ? { response } : { response: context.json({ error: "audio unavailable" }, 502), reason: "audio unavailable from YouTube" };
  };

  const serveAudio = (kind: AlexaAudioKind) => async (context: Context) => {
    const settings = enabled();
    if (!settings) return context.json({ error: "not found" }, 404);
    const videoId = context.req.param("id") ?? "";
    const startedAt = now();
    const { response, reason } = await audioResponse(kind, context, settings, videoId);
    const range = context.req.header("range") ?? null;
    const fields = { skill: kind, videoId, method: context.req.method, range, status: response.status, ms: now() - startedAt };
    if (!response.ok) log.warn("alexa.audio_failed", { ...fields, reason });
    // A song streams as many range requests; the first one (and how long it took) is what matters.
    else if (!range || /^bytes=0-/i.test(range)) log.info("alexa.audio", fields);
    return response;
  };
  router.get("/audio/:id", serveAudio("music"));
  router.get("/video-audio/:id", serveAudio("video"));

  return router;
}
