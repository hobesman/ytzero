import { Hono, type Context } from "hono";
import { alexaAudioLink, verifyAlexaAudioLink } from "../alexa/alexaAudioLinks";
import { alexaConfig, resolveAlexaProfile, type AlexaConfig } from "../alexa/alexaConfig";
import { speak } from "../alexa/alexaPlayback";
import { createAlexaSignatureVerifier, type AlexaSignatureVerifier } from "../alexa/alexaSignature";
import { createAlexaSkill, envelopeSkillId, type AlexaEnvelope, type AlexaSkillDependencies } from "../alexa/alexaSkill";
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

export interface AlexaRouteDependencies {
  config?: () => AlexaConfig | { disabled: string };
  verifier?: Pick<AlexaSignatureVerifier, "check">;
  resolveProfile?: (profile: string) => Promise<number | null>;
  isChild?: (userId: number) => Promise<boolean>;
  audio?: () => Promise<{ audio: MusicAudio; ytdlpAvailable: () => Promise<boolean> }>;
  skill?: Partial<AlexaSkillDependencies>;
  now?: () => number;
}

/**
 * A private Alexa skill. It lives outside the authenticated API: Alexa sends
 * no cookie, so the skill request proves itself with Amazon's signature, and
 * each audio link with its own HMAC. Neither grants any other API access.
 */
export function createAlexaRouter(dependencies: AlexaRouteDependencies = {}): Hono {
  const router = new Hono();
  const config = dependencies.config ?? (() => alexaConfig());
  const now = dependencies.now ?? Date.now;
  const verifier = dependencies.verifier ?? createAlexaSignatureVerifier();
  const resolveProfile = dependencies.resolveProfile ?? resolveAlexaProfile;
  const isChild = dependencies.isChild ?? isChildUser;
  let audioDependencies: ReturnType<typeof defaultMusicAudio> | null = null;
  const audioService = dependencies.audio ?? (() => audioDependencies ??= defaultMusicAudio());

  let skill: ReturnType<typeof createAlexaSkill> | null = null;
  const skillFor = (settings: AlexaConfig) => {
    if (skill) return skill;
    const client = dependencies.skill?.client as ReturnType<typeof createYouTubeMusicClient> | undefined ?? createYouTubeMusicClient();
    return skill = createAlexaSkill({
      client,
      stations: dependencies.skill?.stations ?? createMusicStations(client, createMusicPages(client)),
      prepare: dependencies.skill?.prepare ?? ((userId, videoId) => {
        audioService()
          .then(async ({ audio, ytdlpAvailable }) => { if (await ytdlpAvailable()) await audio.prepare(userId, videoId); })
          .catch(() => {});
      }),
      audioLink: dependencies.skill?.audioLink ?? ((videoId, userId) => alexaAudioLink(settings.publicUrl, settings.secret, videoId, userId, now())),
      recordPlay: dependencies.skill?.recordPlay ?? recordMusicPlay,
      findTrack: dependencies.skill?.findTrack,
      saveTracks: dependencies.skill?.saveTracks,
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
    if (envelopeSkillId(envelope) !== settings.skillId) {
      log.warn("alexa.request_refused", { reason: "wrong skill" });
      return context.json({ error: "wrong skill" }, 400);
    }
    const userId = await resolveProfile(settings.profile);
    if (!userId) {
      log.warn("alexa.profile_missing", { profile: settings.profile });
      return context.json(speak("YT Zero can't find the profile this skill is set up to use."));
    }
    if (await isChild(userId)) return context.json(speak("Music isn't available on this profile."));
    return context.json(await skillFor(settings).handle(userId, envelope));
  });

  const serveAudio = async (context: Context) => {
    const settings = enabled();
    if (!settings) return context.json({ error: "not found" }, 404);
    const videoId = context.req.param("id") ?? "";
    const userId = verifyAlexaAudioLink(settings.secret, videoId, new URL(context.req.url).searchParams, now());
    if (!userId) return context.json({ error: "invalid link" }, 403);
    if (await isChild(userId) || !await musicTrack(videoId)) return context.json({ error: "not found" }, 404);
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
  };
  router.get("/audio/:id", serveAudio);

  return router;
}
