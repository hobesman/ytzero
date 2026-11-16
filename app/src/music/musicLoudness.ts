import { youtubeFetch } from "../youtubeFetch";
import { isYouTubeRefusalError, readYouTubeResponse, youtubeRefusalGate, type YouTubeRefusalGate } from "../youtubeRateLimit";

/*
 * How loud each song is, for volume levelling. YouTube measures every song
 * (integrated loudness, LKFS) and sends, in its player response, how far it is
 * above YouTube's -14 LKFS target: `loudnessDb`. Players turn a song down by
 * that much, never up. Web clients get no player response without a
 * proof-of-origin token, so this asks as YouTube's iOS app, which does.
 *
 * Kept in memory only: it is a cache YouTube can always answer again, so no
 * table or backup holds it.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CACHE_LIMIT = 20_000;
const MISS_TTL_MS = 3_600_000;
const IOS_CLIENT = { clientName: "IOS", clientVersion: "20.10.4", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82", hl: "en", gl: "US" };
const IOS_USER_AGENT = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** dB above YouTube's target loudness (positive is louder), from a player response; null when it has none. */
export function parseLoudnessDb(player: unknown): number | null {
  const audio = (player as { playerConfig?: { audioConfig?: Record<string, unknown> } } | null)?.playerConfig?.audioConfig;
  if (!audio) return null;
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const absolute = number(audio.trackAbsoluteLoudnessLkfs) ?? number(audio.perceptualLoudnessDb);
  const value = number(audio.loudnessDb) ?? (absolute === null ? null : absolute - (number(audio.loudnessTargetLkfs) ?? -14));
  if (value === null || value < -40 || value > 40) return null;
  return Math.round(value * 100) / 100;
}

export function createMusicLoudness(options: { fetch?: Fetcher; now?: () => number; gate?: YouTubeRefusalGate } = {}) {
  const request = options.fetch ?? youtubeFetch;
  const gate = options.gate ?? youtubeRefusalGate;
  const now = options.now ?? Date.now;
  const known = new Map<string, { value: number | null; at: number }>();
  const pending = new Map<string, Promise<number | null>>();

  function cached(videoId: string): number | null | undefined {
    const entry = known.get(videoId);
    if (!entry) return undefined;
    if (entry.value === null && now() - entry.at > MISS_TTL_MS) { known.delete(videoId); return undefined; }
    return entry.value;
  }

  function remember(videoId: string, value: number | null) {
    known.delete(videoId);
    known.set(videoId, { value, at: now() });
    while (known.size > CACHE_LIMIT) known.delete(known.keys().next().value!);
  }

  /** Undefined when YouTube is refusing requests, so the song is asked about again later. */
  async function fetchLoudness(videoId: string): Promise<number | null | undefined> {
    try {
      gate.enter();
    } catch {
      return undefined;
    }
    try {
      const response = await request("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": IOS_USER_AGENT },
        body: JSON.stringify({ context: { client: IOS_CLIENT }, videoId, contentCheckOk: true, racyCheckOk: true }),
      });
      const text = await readYouTubeResponse(response, "YouTube player failed");
      gate.answered();
      try { return parseLoudnessDb(JSON.parse(text)); } catch { return null; }
    } catch (error) {
      if (isYouTubeRefusalError(error)) { gate.refused(error); return undefined; }
      gate.releaseProbe();
      return null;
    }
  }

  /** The song's loudness, asking YouTube when it isn't known yet. Never throws. */
  function get(videoId: string): Promise<number | null> {
    if (!VIDEO_ID.test(videoId)) return Promise.resolve(null);
    const hit = cached(videoId);
    if (hit !== undefined) return Promise.resolve(hit);
    const running = pending.get(videoId);
    if (running) return running;
    const task = fetchLoudness(videoId)
      .then((value) => {
        if (value === undefined) return null;
        remember(videoId, value);
        return value;
      })
      .finally(() => pending.delete(videoId));
    pending.set(videoId, task);
    return task;
  }

  /** What is known already, without asking: null when YouTube had none, undefined when not asked yet. */
  function peek(videoId: string): number | null | undefined {
    return cached(videoId);
  }

  return { get, peek };
}

export type MusicLoudness = ReturnType<typeof createMusicLoudness>;

/** The server's one loudness cache, which every track list the music routes return reads from. */
export const musicLoudness = createMusicLoudness();
