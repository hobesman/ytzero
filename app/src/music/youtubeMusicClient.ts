import { youtubeFetch } from "../youtubeFetch";
import { readYouTubeResponse, youtubeRefusalGate, isYouTubeRefusalError } from "../youtubeRateLimit";
import { resolveYouTubeLanguage, youtubeRequestHeaders } from "../youtubeRequestLanguage";
import { parseRadioResponse, parseSearchResponse, type MusicTrack } from "./youtubeMusicParsers";

export type { MusicTrack };

const MUSIC_ORIGIN = "https://music.youtube.com";
const FALLBACK_MUSIC_CLIENT_VERSION = "1.20241106.01.00";
const CLIENT_VERSION_TTL_MS = 12 * 3_600_000;
// YouTube Music's "Songs" search filter.
const SONGS_FILTER = "EgWKAQIIAWoKEAkQBRAKEAMQBA==";
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

let clientVersion: { value: string; at: number } | null = null;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface YouTubeMusicClientOptions {
  fetch?: Fetcher;
}

export function createYouTubeMusicClient(options: YouTubeMusicClientOptions = {}) {
  const request: Fetcher = options.fetch ?? youtubeFetch;

  // Music requests never carry the profile's YouTube cookies, so listening here
  // is not recorded in the user's real Google account either.
  function headers(userId: number, origin: string): Record<string, string> {
    const language = resolveYouTubeLanguage(userId);
    return { ...youtubeRequestHeaders(userId, language, false), "Content-Type": "application/json", Origin: origin, Referer: `${origin}/` };
  }

  async function musicClientVersion(userId: number): Promise<string> {
    if (clientVersion && Date.now() - clientVersion.at < CLIENT_VERSION_TTL_MS) return clientVersion.value;
    try {
      const response = await request(`${MUSIC_ORIGIN}/`, { headers: headers(userId, MUSIC_ORIGIN) });
      const html = await readYouTubeResponse(response, "YouTube Music page fetch failed");
      const value = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? FALLBACK_MUSIC_CLIENT_VERSION;
      clientVersion = { value, at: Date.now() };
      return value;
    } catch (error) {
      if (isYouTubeRefusalError(error)) throw error;
      return FALLBACK_MUSIC_CLIENT_VERSION;
    }
  }

  async function innertube(userId: number, origin: string, endpoint: "next" | "search", client: { clientName: string; clientVersion: string }, body: Record<string, unknown>): Promise<unknown> {
    youtubeRefusalGate.enter();
    try {
      const language = resolveYouTubeLanguage(userId);
      const response = await request(`${origin}/youtubei/v1/${endpoint}?prettyPrint=false`, {
        method: "POST",
        headers: headers(userId, origin),
        body: JSON.stringify({ context: { client: { ...client, hl: language.hl, gl: "US" } }, ...body }),
      });
      const text = await readYouTubeResponse(response, `YouTube Music ${endpoint} failed`);
      youtubeRefusalGate.answered();
      return JSON.parse(text);
    } catch (error) {
      if (isYouTubeRefusalError(error)) throw youtubeRefusalGate.refused(error);
      youtubeRefusalGate.releaseProbe();
      throw error;
    }
  }

  async function searchSongs(userId: number, query: string): Promise<MusicTrack[]> {
    const version = await musicClientVersion(userId);
    const data = await innertube(userId, MUSIC_ORIGIN, "search", { clientName: "WEB_REMIX", clientVersion: version }, { query, params: SONGS_FILTER });
    return parseSearchResponse(data);
  }

  /** YouTube Music's radio for a song, falling back to the regular YouTube Mix. */
  async function radio(userId: number, videoId: string): Promise<MusicTrack[]> {
    if (!VIDEO_ID.test(videoId)) return [];
    try {
      const version = await musicClientVersion(userId);
      const data = await innertube(userId, MUSIC_ORIGIN, "next", { clientName: "WEB_REMIX", clientVersion: version }, {
        videoId, playlistId: `RDAMVM${videoId}`, isAudioOnly: true,
      });
      const tracks = parseRadioResponse(data);
      if (tracks.length > 1) return tracks;
    } catch (error) {
      if (isYouTubeRefusalError(error)) throw error;
    }
    const data = await innertube(userId, "https://www.youtube.com", "next", { clientName: "WEB", clientVersion: "2.20241106.01.00" }, {
      videoId, playlistId: `RD${videoId}`,
    });
    return parseRadioResponse(data);
  }

  return { searchSongs, radio };
}

export type YouTubeMusicClient = ReturnType<typeof createYouTubeMusicClient>;
