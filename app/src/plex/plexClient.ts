/**
 * The user's Plex Media Server, as the Hoban Plex skill uses it: movie and
 * TV libraries, a title's audio tracks and chapters, what's on deck, and
 * watch progress. Configured only by machine-bound environment variables and
 * off until both are set. The token is a secret: it never leaves this module
 * in a log line, an API response or a link handed to an Echo.
 *
 * Written against Plex's documented REST API (JSON with `Accept:
 * application/json`): /library/sections, /hubs/search, /library/metadata/:id,
 * /library/metadata/:id/allLeaves, /library/onDeck, /:/progress, /:/scrobble.
 */
export interface PlexConfig {
  /** Where this server reaches Plex, such as http://127.0.0.1:32400. */
  url: string;
  /** An X-Plex-Token for the Plex user whose watch progress the Echo shares. */
  token: string;
}

type Environment = Record<string, string | undefined>;
type Json = Record<string, any>;
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const unquote = (value: string | undefined) => (value ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();

/** The configuration, or why the connection is off. */
export function plexConfig(environment: Environment = process.env): PlexConfig | { disabled: string } {
  const url = unquote(environment.YTZERO_PLEX_URL).replace(/\/+$/, "");
  const token = unquote(environment.YTZERO_PLEX_TOKEN);
  if (!url && !token) return { disabled: "YTZERO_PLEX_URL and YTZERO_PLEX_TOKEN are not set" };
  if (!url) return { disabled: "YTZERO_PLEX_URL is not set" };
  if (!token) return { disabled: "YTZERO_PLEX_TOKEN is not set" };
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { disabled: "YTZERO_PLEX_URL is not a valid address" }; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { disabled: "YTZERO_PLEX_URL must start with http:// or https://" };
  return { url: parsed.origin + parsed.pathname.replace(/\/+$/, ""), token };
}

export class PlexError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
  }
}

/** Plex's ratingKey: a number, as a string. */
const RATING_KEY = /^\d{1,12}$/;
export const isPlexId = (value: unknown): value is string => typeof value === "string" && RATING_KEY.test(value);

const text = (value: unknown) => typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
const list = (value: unknown): Json[] => Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object") : [];

/** One audio track of a title's file. */
export interface PlexAudioStream {
  /** The stream's index in the file, as ffmpeg numbers it (`-map 0:<index>`). */
  index: number;
  codec: string;
  channels: number;
  language: string;
  title: string;
  selected: boolean;
  default: boolean;
}

export interface PlexChapter { start: number; end: number; title: string }

/** A movie or an episode, as the skill plays it. Times are seconds. */
export interface PlexItem {
  id: string;
  type: "movie" | "episode";
  title: string;
  year: number | null;
  /** An episode's show, season and episode numbers. */
  show: { id: string; title: string } | null;
  season: number | null;
  episode: number | null;
  duration: number;
  /** Where Plex says the user is, 0 when not started. */
  viewOffset: number;
  watched: boolean;
  /** The file's path on Plex (/library/parts/…), for ffmpeg. */
  partKey: string;
  audio: PlexAudioStream[];
  chapters: PlexChapter[];
  /** A Plex image path for the poster (an episode's show poster). */
  thumb: string;
  contentRating: string;
  lastViewedAt: number;
}

/** A search hit or a show, before its file is looked up. */
export interface PlexSummary {
  id: string;
  type: "movie" | "show" | "episode";
  title: string;
  year: number | null;
  /** An episode's show. */
  showTitle: string | null;
}

export interface PlexLibrary { id: string; type: "movie" | "show"; title: string }

/** A title from /library/metadata/:id. Null for anything that isn't a playable movie or episode. */
export function parsePlexItem(entry: Json | null | undefined): PlexItem | null {
  if (!entry || !isPlexId(text(entry.ratingKey))) return null;
  const type = entry.type === "movie" || entry.type === "episode" ? entry.type : null;
  if (!type) return null;
  const media = list(entry.Media)[0];
  const part = media ? list(media.Part)[0] : undefined;
  const partKey = text(part?.key);
  if (!partKey.startsWith("/library/parts/")) return null;
  const duration = number(entry.duration ?? media?.duration ?? part?.duration) / 1000;
  if (!(duration > 0)) return null;
  const audio = list(part?.Stream).filter((stream) => number(stream.streamType) === 2).map((stream) => ({
    index: number(stream.index),
    codec: text(stream.codec).toLowerCase(),
    channels: number(stream.channels),
    language: text(stream.languageCode ?? stream.languageTag ?? stream.language).toLowerCase(),
    title: text(stream.title ?? stream.displayTitle ?? stream.extendedDisplayTitle),
    selected: stream.selected === true || stream.selected === 1 || stream.selected === "1",
    default: stream.default === true || stream.default === 1 || stream.default === "1",
  }));
  const chapters = list(entry.Chapter)
    .map((chapter) => ({ start: number(chapter.startTimeOffset) / 1000, end: number(chapter.endTimeOffset) / 1000, title: text(chapter.tag) }))
    .filter((chapter) => chapter.end > chapter.start)
    .sort((a, b) => a.start - b.start);
  const showId = text(entry.grandparentRatingKey);
  return {
    id: text(entry.ratingKey),
    type,
    title: text(entry.title) || "Untitled",
    year: number(entry.year) || null,
    show: type === "episode" && isPlexId(showId) ? { id: showId, title: text(entry.grandparentTitle) } : null,
    season: type === "episode" ? number(entry.parentIndex) || null : null,
    episode: type === "episode" ? number(entry.index) || null : null,
    duration,
    viewOffset: Math.max(0, number(entry.viewOffset) / 1000),
    watched: number(entry.viewCount) > 0,
    partKey,
    audio,
    chapters,
    thumb: text(type === "episode" ? entry.grandparentThumb || entry.parentThumb || entry.thumb : entry.thumb),
    contentRating: text(entry.contentRating),
    lastViewedAt: number(entry.lastViewedAt),
  };
}

export function parsePlexSummary(entry: Json | null | undefined): PlexSummary | null {
  if (!entry || !isPlexId(text(entry.ratingKey))) return null;
  const type = entry.type === "movie" || entry.type === "show" || entry.type === "episode" ? entry.type : null;
  if (!type) return null;
  return {
    id: text(entry.ratingKey),
    type,
    title: text(entry.title) || "Untitled",
    year: number(entry.year) || null,
    showTitle: type === "episode" ? text(entry.grandparentTitle) || null : null,
  };
}

const COMMENTARY = /commentary|descriptive|audio description|director/i;

/**
 * The audio track to play: the one Plex has selected for this user, else
 * the file's default, else the first English one, else the first that isn't
 * a commentary or described-video track, else the first.
 */
export function chooseAudioStream(streams: readonly PlexAudioStream[]): PlexAudioStream | null {
  return streams.find((stream) => stream.selected)
    ?? streams.find((stream) => stream.default)
    ?? streams.find((stream) => /^(en|eng)$/.test(stream.language) && !COMMENTARY.test(stream.title))
    ?? streams.find((stream) => !COMMENTARY.test(stream.title))
    ?? streams[0]
    ?? null;
}

/** Plex's REST API, as far as Hoban Plex uses it. */
export function createPlexClient(config: PlexConfig, fetcher: Fetch = fetch, timeoutMs = 8000) {
  const headers = {
    "X-Plex-Token": config.token,
    Accept: "application/json",
    "X-Plex-Product": "YT Zero",
    "X-Plex-Client-Identifier": "ytzero-hoban-movies",
  };

  async function call(path: string): Promise<Json | null> {
    let response: Response;
    try {
      response = await fetcher(`${config.url}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new PlexError(`Plex is unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status === 401 || response.status === 403) throw new PlexError("Plex refused the token", response.status);
    if (response.status === 404) throw new PlexError("Plex has no such item", 404);
    if (!response.ok) throw new PlexError(`Plex answered ${response.status}`, response.status);
    const type = response.headers.get("content-type") ?? "";
    const body = type.includes("json") ? await response.json().catch(() => null) : (await response.body?.cancel().catch(() => {}), null);
    return (body as Json | null)?.MediaContainer ?? null;
  }

  return {
    async libraries(): Promise<PlexLibrary[]> {
      const container = await call("/library/sections");
      return list(container?.Directory).filter((entry) => entry.type === "movie" || entry.type === "show")
        .map((entry) => ({ id: text(entry.key), type: entry.type, title: text(entry.title) }));
    },

    /** Movies, shows and episodes matching spoken words, across every library. */
    async search(query: string, limit = 10): Promise<PlexSummary[]> {
      const container = await call(`/hubs/search?${new URLSearchParams({ query, limit: String(limit), includeCollections: "0" })}`);
      const found: PlexSummary[] = [];
      for (const hub of list(container?.Hub)) {
        if (hub.type !== "movie" && hub.type !== "show" && hub.type !== "episode") continue;
        for (const entry of list(hub.Metadata)) {
          const summary = parsePlexSummary(entry);
          if (summary) found.push(summary);
        }
      }
      return found;
    },

    async item(id: string): Promise<PlexItem | null> {
      if (!isPlexId(id)) return null;
      try {
        return parsePlexItem(list((await call(`/library/metadata/${id}?includeChapters=1`))?.Metadata)[0]);
      } catch (error) {
        if (error instanceof PlexError && error.status === 404) return null;
        throw error;
      }
    },

    /** Every episode of a show, in order, with what's been watched. */
    async episodes(showId: string): Promise<PlexItem[]> {
      if (!isPlexId(showId)) return [];
      const container = await call(`/library/metadata/${showId}/allLeaves`);
      return list(container?.Metadata).map(parsePlexItem).filter((item): item is PlexItem => item !== null)
        .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
    },

    /** What Plex would carry on with: movies part way through and shows' next episodes, latest first. */
    async onDeck(limit = 10): Promise<PlexItem[]> {
      const container = await call(`/library/onDeck?${new URLSearchParams({ "X-Plex-Container-Size": String(limit), "X-Plex-Container-Start": "0" })}`);
      return list(container?.Metadata).map(parsePlexItem).filter((item): item is PlexItem => item !== null);
    },

    /** Saves where the user is in a title (/:/progress), as a Plex player does between sessions. */
    async saveProgress(id: string, seconds: number, state: "playing" | "paused" | "stopped" = "stopped"): Promise<void> {
      if (!isPlexId(id)) throw new PlexError("not a Plex item");
      await call(`/:/progress?${new URLSearchParams({ key: id, identifier: "com.plexapp.plugins.library", time: String(Math.max(0, Math.round(seconds * 1000))), state })}`);
    },

    /** Marks a title watched (/:/scrobble), which also clears its place. */
    async markWatched(id: string): Promise<void> {
      if (!isPlexId(id)) throw new PlexError("not a Plex item");
      await call(`/:/scrobble?${new URLSearchParams({ key: id, identifier: "com.plexapp.plugins.library" })}`);
    },

    /** A poster, passed through at a size for the Echo's screen. */
    async image(path: string, signal?: AbortSignal): Promise<Response> {
      if (!/^\/library\/metadata\/\d{1,12}\/(thumb|art)(\/\d{1,20})?$/.test(path)) throw new PlexError("not a Plex image");
      const query = new URLSearchParams({ width: "600", height: "600", minSize: "1", upscale: "1", url: path });
      return fetcher(`${config.url}/photo/:/transcode?${query}`, { headers: { "X-Plex-Token": config.token }, signal });
    },

    /** Where a title's file is, with the header that opens it, for ffmpeg to read with ranges. Never logged. */
    fileSource(partKey: string): { url: string; headers: Record<string, string> } {
      if (!partKey.startsWith("/library/parts/")) throw new PlexError("not a Plex file");
      return { url: `${config.url}${partKey}`, headers: { "X-Plex-Token": config.token } };
    },
  };
}

export type PlexClient = ReturnType<typeof createPlexClient>;

let defaultClient: { key: string; client: PlexClient } | null = null;

/** The server's client, or why there is none. */
export function defaultPlex(): PlexClient | { disabled: string } {
  const config = plexConfig();
  if ("disabled" in config) return config;
  const key = `${config.url}\n${config.token}`;
  if (defaultClient?.key !== key) defaultClient = { key, client: createPlexClient(config) };
  return defaultClient.client;
}
