import { log } from "../logger";

/**
 * LRCLIB (lrclib.net), a free, open lyrics database with time-synced lyrics.
 * Requests carry only a song's artist, title, album and length: never anything
 * about the profile, its account or what else it plays.
 */

export interface LyricLine {
  /** Seconds from the start of the song. */
  time: number;
  text: string;
}

export interface LrclibLyrics {
  synced: LyricLine[] | null;
  plain: string | null;
  instrumental: boolean;
}

export interface LrclibQuery {
  artist: string;
  title: string;
  album: string | null;
  duration: number | null;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const ORIGIN = "https://lrclib.net";
const TIMEOUT_MS = 8000;
// LRCLIB asks clients to name themselves; this names the app, not the person using it.
const USER_AGENT = "YTZero (https://github.com/Pelski/ytzero)";
const MAX_LINES = 2000;
/** How far a found song's length may be from ours, in seconds, and still be the same recording. */
const DURATION_SLACK = 3;


/** Lines of an LRC file in time order. Metadata tags such as `[ar:…]` are skipped; a line with several stamps repeats. */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.replace(/\r\n?/g, "\n").split("\n")) {
    const stamps: number[] = [];
    let rest = raw;
    for (;;) {
      const match = /^\s*\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/.exec(rest);
      if (!match) break;
      const seconds = Number(match[1]) * 60 + Number(match[2]!.replace(":", "."));
      if (Number.isFinite(seconds)) stamps.push(seconds);
      rest = rest.slice(match[0].length);
    }
    if (!stamps.length) continue;
    // Word-level stamps ("<00:12.34>") are dropped: lines are highlighted whole.
    const text = rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "").trim();
    for (const time of stamps) lines.push({ time: Math.round(time * 100) / 100, text });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines.slice(0, MAX_LINES);
}

interface LrclibRecord {
  trackName?: unknown; artistName?: unknown; duration?: unknown; instrumental?: unknown; plainLyrics?: unknown; syncedLyrics?: unknown;
}

function fromRecord(found: LrclibRecord): LrclibLyrics | null {
  const synced = typeof found.syncedLyrics === "string" ? parseLrc(found.syncedLyrics) : [];
  const plain = typeof found.plainLyrics === "string" ? found.plainLyrics.replace(/\r\n?/g, "\n").trim().slice(0, 20_000) : "";
  const instrumental = found.instrumental === true;
  if (!synced.length && !plain && !instrumental) return null;
  return { synced: synced.length ? synced : null, plain: plain || null, instrumental };
}

/** A title without what YouTube adds and LRCLIB rarely has: "(Official Video)", "[Remastered 2011]", "- Remastered". */
export function plainTitle(title: string): string {
  return title
    .replace(/\s*[([][^)\]]*(official|video|audio|lyric|visuali[sz]er|remaster|live|hd|4k|mv)[^)\]]*[)\]]/gi, "")
    .replace(/\s+-\s+[^-]*remaster[^-]*$/i, "")
    .trim() || title;
}

/** The first credited artist: "A & B", "A, B" and "A feat. B" become "A". */
export function firstArtist(artist: string): string {
  return artist.split(/\s*(?:,|&| x | and |\bfeat\.?|\bft\.?|\bfeaturing\b)\s*/i)[0]?.trim() || artist;
}

export function createLrclibClient(options: { fetch?: Fetcher } = {}) {
  const request: Fetcher = options.fetch ?? fetch;

  async function call(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await request(`${ORIGIN}${path}`, { signal: controller.signal, headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`LRCLIB answered ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timer); }
  }

  /**
   * The song's lyrics, or null when LRCLIB has none. An exact match on artist,
   * title and length comes first; then a search, taking the closest length.
   */
  async function find(query: LrclibQuery): Promise<LrclibLyrics | null> {
    const title = plainTitle(query.title);
    const artist = firstArtist(query.artist);
    if (query.duration) {
      const params = new URLSearchParams({ artist_name: artist, track_name: title, duration: String(Math.round(query.duration)) });
      if (query.album) params.set("album_name", query.album);
      const exact = await call(`/api/get?${params}`);
      const lyrics = exact && typeof exact === "object" ? fromRecord(exact as LrclibRecord) : null;
      if (lyrics) return lyrics;
    }
    const found = await call(`/api/search?${new URLSearchParams({ artist_name: artist, track_name: title })}`);
    if (!Array.isArray(found)) return null;
    const candidates = (found as LrclibRecord[]).filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({ entry, gap: query.duration && typeof entry.duration === "number" ? Math.abs(entry.duration - query.duration) : 0 }))
      .filter(({ gap }) => gap <= DURATION_SLACK)
      // Synced lyrics first, then the closest length.
      .sort((a, b) => Number(typeof b.entry.syncedLyrics === "string") - Number(typeof a.entry.syncedLyrics === "string") || a.gap - b.gap);
    for (const { entry } of candidates) {
      const lyrics = fromRecord(entry);
      if (lyrics) return lyrics;
    }
    return null;
  }

  return {
    async find(query: LrclibQuery): Promise<LrclibLyrics | null> {
      try { return await find(query); }
      catch (error) {
        log.warn("music.lrclib_failed", { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
  };
}

export type LrclibClient = ReturnType<typeof createLrclibClient>;
