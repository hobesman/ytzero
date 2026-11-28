import { getUserSetting } from "../db";
import { log } from "../logger";
import { musicLoudness } from "../music/musicLoudness";
import type { AlexaAudioKind } from "./alexaAudioLinks";

/**
 * What the server does to a song's or a video's audio on its way to an Echo,
 * as the app's own players do in the browser: SponsorBlock's segments cut
 * out (the profile's categories, when it has SponsorBlock on) and, for music
 * with volume levelling on, a loud song turned down to YouTube's loudness
 * target. An Echo can't be told to skip or to play quieter, so ffmpeg does
 * both before the audio leaves (see alexaProcessedAudio.ts).
 *
 * Cutting changes the stream's timeline. An Echo reports places as the offset
 * it was sent plus the time it has played, so the offsets an Echo sees are
 * all on the cut timeline ("Echo time"), and the server turns them into
 * places in the video ("video time") at the boundary: see alexaAudioTimeline.ts.
 */

/** A stretch of the video that isn't played. Seconds. */
export interface AudioCut { start: number; end: number }

export interface AudioPlan {
  /** Sorted, merged, none shorter than a second. */
  cuts: AudioCut[];
  /** The change in volume, in dB: 0, or negative to turn down. */
  volumeDb: number;
}

export const UNCHANGED: AudioPlan = { cuts: [], volumeDb: 0 };

export const isProcessed = (plan: AudioPlan | null | undefined): plan is AudioPlan => Boolean(plan && (plan.cuts.length || plan.volumeDb < 0));

/** A video place on the cut timeline: the place less every cut before it. */
export function toEchoTime(cuts: readonly AudioCut[], videoSeconds: number): number {
  let removed = 0;
  for (const cut of cuts) {
    if (cut.start >= videoSeconds) break;
    removed += Math.min(cut.end, videoSeconds) - cut.start;
  }
  return Math.max(0, videoSeconds - removed);
}

/** The video place an Echo place stands for. A place at a cut's start is its end: the cut isn't heard. */
export function toVideoTime(cuts: readonly AudioCut[], echoSeconds: number): number {
  let video = Math.max(0, echoSeconds);
  for (const cut of cuts) {
    if (cut.start > video) break;
    video += cut.end - cut.start;
  }
  return video;
}

/** Overlapping and touching segments as one; anything under a second left out. */
export function mergeCuts(segments: readonly AudioCut[]): AudioCut[] {
  const sorted = segments.filter((cut) => Number.isFinite(cut.start) && Number.isFinite(cut.end) && cut.end > cut.start)
    .map((cut) => ({ start: Math.max(0, cut.start), end: cut.end })).sort((a, b) => a.start - b.start);
  const merged: AudioCut[] = [];
  for (const cut of sorted) {
    const last = merged.at(-1);
    if (last && cut.start <= last.end) last.end = Math.max(last.end, cut.end);
    else merged.push({ ...cut });
  }
  return merged.filter((cut) => cut.end - cut.start >= 1);
}

/** The most a loud song is turned down, as the app's own music player caps it. */
const MAX_TURN_DOWN_DB = 30;

/** How much quieter a song plays: YouTube's figure for how far above its target it is, never louder. */
export function levellingDb(loudnessDb: number | null | undefined): number {
  return typeof loudnessDb === "number" && Number.isFinite(loudnessDb) && loudnessDb > 0 ? -Math.min(loudnessDb, MAX_TURN_DOWN_DB) : 0;
}

/** The profile's SponsorBlock categories, or none when it has SponsorBlock off. */
export function sponsorCategories(setting: (key: string) => string | null): string[] {
  if (setting("sponsorblock_enabled") !== "1") return [];
  try {
    const parsed = JSON.parse(setting("sponsorblock_categories") ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && /^[a-z_]{1,32}$/.test(value)) : [];
  } catch {
    return [];
  }
}

const PLAN_TTL_MS = 6 * 60 * 60 * 1000;
const PLAN_LIMIT = 500;
/** How long working out a plan may hold up Alexa's answer. */
export const PLAN_WAIT_MS = 2_000;

export interface AlexaAudioPlanDependencies {
  /** SponsorBlock's skip segments for these categories; [] when there are none or it can't be reached. */
  segments: (videoId: string, categories: string[]) => Promise<AudioCut[]>;
  /** YouTube's loudness figure for a song, or null. */
  loudness: (videoId: string) => Promise<number | null | undefined>;
  setting: (userId: number, key: string) => string | null;
  now?: () => number;
  waitMs?: number;
}

/**
 * Each stream's plan, decided once and kept for hours, so the stream, the
 * offsets sent with it and every place its Echo reports later agree.
 */
export function createAlexaAudioPlans(dependencies: AlexaAudioPlanDependencies) {
  const now = dependencies.now ?? Date.now;
  const waitMs = dependencies.waitMs ?? PLAN_WAIT_MS;
  const plans = new Map<string, { plan: AudioPlan; at: number }>();
  const key = (userId: number, kind: AlexaAudioKind, videoId: string) => `${userId}\n${kind}\n${videoId}`;

  function bounded<T>(task: Promise<T>, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([task.catch(() => fallback), new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), waitMs); })])
      .finally(() => clearTimeout(timer));
  }

  function peek(userId: number, kind: AlexaAudioKind, videoId: string): AudioPlan | null {
    const hit = plans.get(key(userId, kind, videoId));
    return hit && now() - hit.at < PLAN_TTL_MS ? hit.plan : null;
  }

  async function get(userId: number, kind: AlexaAudioKind, videoId: string): Promise<AudioPlan> {
    const known = peek(userId, kind, videoId);
    if (known) return known;
    const setting = (name: string) => dependencies.setting(userId, name);
    const categories = sponsorCategories(setting);
    const levelling = kind === "music" && setting("music_volume_leveling") !== "0";
    const [segments, loudness] = await Promise.all([
      categories.length ? bounded(dependencies.segments(videoId, categories), [] as AudioCut[]) : Promise.resolve([] as AudioCut[]),
      levelling ? bounded(dependencies.loudness(videoId), null) : Promise.resolve(null),
    ]);
    const plan: AudioPlan = { cuts: mergeCuts(segments), volumeDb: levellingDb(loudness) };
    plans.delete(key(userId, kind, videoId));
    plans.set(key(userId, kind, videoId), { plan, at: now() });
    while (plans.size > PLAN_LIMIT) plans.delete(plans.keys().next().value!);
    if (isProcessed(plan)) log.info("alexa.audio_plan", { kind, videoId, cuts: plan.cuts.length, cutSeconds: Math.round(plan.cuts.reduce((sum, cut) => sum + cut.end - cut.start, 0)), volumeDb: Math.round(plan.volumeDb * 10) / 10 });
    return plan;
  }

  return { get, peek };
}

export type AlexaAudioPlans = ReturnType<typeof createAlexaAudioPlans>;

const SPONSORBLOCK_URL = "https://sponsor.ajay.app/api/skipSegments";
const SEGMENT_TTL_MS = 6 * 60 * 60 * 1000;
const SEGMENT_FAILURE_TTL_MS = 10 * 60 * 1000;
const SEGMENT_FETCH_TIMEOUT_MS = 5_000;

/**
 * SponsorBlock's skip segments, as the app's video player asks for them,
 * kept for hours. Only "skip" segments count: a mute or a highlight isn't a cut.
 */
export function createSponsorBlockSegments(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  const cache = new Map<string, { cuts: AudioCut[]; until: number }>();
  return async (videoId: string, categories: string[]): Promise<AudioCut[]> => {
    const cacheKey = `${videoId}\n${[...categories].sort().join(",")}`;
    const hit = cache.get(cacheKey);
    if (hit && hit.until > now()) return hit.cuts;
    let cuts: AudioCut[] = [];
    let ttl = SEGMENT_TTL_MS;
    try {
      const query = new URLSearchParams({ videoID: videoId, categories: JSON.stringify(categories) });
      const response = await fetcher(`${SPONSORBLOCK_URL}?${query}`, { signal: AbortSignal.timeout(SEGMENT_FETCH_TIMEOUT_MS), headers: { "User-Agent": "YTZero" } });
      if (response.ok) {
        const body = await response.json() as { segment?: unknown; category?: unknown; actionType?: unknown }[];
        cuts = (Array.isArray(body) ? body : [])
          .filter((item) => (item.actionType ?? "skip") === "skip" && categories.includes(String(item.category)) && Array.isArray(item.segment))
          .map((item) => ({ start: Number((item.segment as unknown[])[0]), end: Number((item.segment as unknown[])[1]) }));
      } else if (response.status !== 404) {
        ttl = SEGMENT_FAILURE_TTL_MS;
      }
    } catch {
      ttl = SEGMENT_FAILURE_TTL_MS;
    }
    cache.set(cacheKey, { cuts, until: now() + ttl });
    while (cache.size > 1000) cache.delete(cache.keys().next().value!);
    return cuts;
  };
}

/** The server's one set of plans: the Alexa endpoint, its audio routes and the room tablet share it. */
export const alexaAudioPlans = createAlexaAudioPlans({
  segments: createSponsorBlockSegments(),
  loudness: (videoId) => musicLoudness.get(videoId),
  setting: getUserSetting,
});
