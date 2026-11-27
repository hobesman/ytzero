import { database } from "../database";
import type { AsyncDatabaseClient } from "../databaseClient";
import { songKey } from "../music/musicSongKey";
import type { MusicTrack } from "../music/youtubeMusicParsers";

/** A song as an Echo reports it through Home Assistant (Amazon Music, say). */
export interface EchoSong {
  title: string;
  artist: string;
  durationMs: number | null;
}

export type EchoMatch =
  | { videoId: string; via: "catalogue" | "search" }
  | { videoId: null; reason: "no-match" | "recent-miss" | "rate-limited" | "search-failed"; error?: string };

export interface EchoMatcherDependencies {
  db?: AsyncDatabaseClient;
  /** YT Zero's own YouTube Music search, as /music/search uses it. */
  search: (userId: number, query: string) => Promise<MusicTrack[]>;
  /** Keeps searched songs in the catalogue, so the play can point at one. */
  remember: (tracks: readonly MusicTrack[]) => Promise<unknown>;
  now?: () => number;
}

/** A song searched without a match is not searched again for this long. Transient: kept in memory only. */
export const ECHO_MISS_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MISSES = 2000;
/** Searches are spaced out and capped per hour, so a busy household never floods YouTube Music. */
export const ECHO_SEARCH_SPACING_MS = 5_000;
export const ECHO_SEARCHES_PER_HOUR = 40;
/** A search result that isn't the same song by key must be this close in length. */
const DURATION_TOLERANCE = 0.1;

const leadArtistOf = (key: string) => key.slice(0, key.indexOf("|"));
const titleOf = (key: string) => key.slice(key.indexOf("|") + 1);

/** Titles that are the same song by their words: one contains the other, or most words are shared. */
export function closeTitles(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `)) return true;
  // "what s up" and "whats up": the same words but for an apostrophe.
  if (a.replace(/ /g, "") === b.replace(/ /g, "")) return true;
  const left = new Set(a.split(" "));
  const right = new Set(b.split(" "));
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.max(left.size, right.size) >= 0.75;
}

const durationClose = (seconds: number | null, durationMs: number | null) =>
  seconds != null && durationMs != null && durationMs > 0 && Math.abs(seconds * 1000 - durationMs) <= durationMs * DURATION_TOLERANCE;
const durationGap = (seconds: number | null, durationMs: number | null) =>
  seconds == null || durationMs == null ? Number.POSITIVE_INFINITY : Math.abs(seconds * 1000 - durationMs);

/**
 * Whether a search result is the Echo's song: the same song key, or the same
 * lead artist with a close title and a length within 10%. Never across artists.
 */
export function acceptsSearchResult(song: EchoSong, track: MusicTrack): boolean {
  const wanted = songKey(song.artist, song.title);
  const found = songKey(track.artist, track.title);
  if (found === wanted) return true;
  if (!leadArtistOf(wanted) || leadArtistOf(found) !== leadArtistOf(wanted)) return false;
  return closeTitles(titleOf(wanted), titleOf(found)) && durationClose(track.duration, song.durationMs);
}

interface CandidateRow { video_id: string; duration: number | null; is_topic: number; known: number; disliked: number }

/** Of tracks that are all the song: one the profile played or liked, then a Topic upload, then the closest length. */
function best<T extends { known: boolean; disliked: boolean; isTopic: boolean; duration: number | null }>(candidates: T[], durationMs: number | null): T | null {
  return [...candidates].sort((a, b) => Number(a.disliked) - Number(b.disliked)
    || Number(b.known) - Number(a.known)
    || Number(b.isTopic) - Number(a.isTopic)
    || durationGap(a.duration, durationMs) - durationGap(b.duration, durationMs))[0] ?? null;
}

/**
 * Finds the YouTube Music track an Echo played: YT Zero's own catalogue first,
 * then YT Zero's YouTube Music search. Misses are remembered for a day.
 */
export function createEchoMatcher(dependencies: EchoMatcherDependencies) {
  const db = dependencies.db ?? database;
  const now = dependencies.now ?? Date.now;
  const misses = new Map<string, number>();
  // A search result accepted by a close title has its own song key, so the catalogue can't find it by the Echo's.
  const found = new Map<string, string>();
  const searches: number[] = [];

  async function fromCatalogue(userId: number, key: string, durationMs: number | null): Promise<string | null> {
    const rows = await db.prepare(`
      SELECT t.video_id, t.duration, t.is_topic,
        CASE WHEN EXISTS (SELECT 1 FROM music_plays p WHERE p.user_id = ? AND p.video_id = t.video_id)
          OR EXISTS (SELECT 1 FROM music_ratings r WHERE r.user_id = ? AND r.video_id = t.video_id AND r.rating = 1) THEN 1 ELSE 0 END AS known,
        CASE WHEN EXISTS (SELECT 1 FROM music_ratings r WHERE r.user_id = ? AND r.video_id = t.video_id AND r.rating = -1) THEN 1 ELSE 0 END AS disliked
      FROM music_tracks t WHERE t.song_key = ?
    `).all<CandidateRow>(userId, userId, userId, key);
    const pick = best(rows.map((row) => ({
      videoId: row.video_id, duration: row.duration == null ? null : Number(row.duration), isTopic: Boolean(Number(row.is_topic)),
      known: Boolean(Number(row.known)), disliked: Boolean(Number(row.disliked)),
    })), durationMs);
    return pick?.videoId ?? null;
  }

  function searchAllowed(at: number): boolean {
    while (searches.length && at - searches[0] > 60 * 60 * 1000) searches.shift();
    if (searches.length >= ECHO_SEARCHES_PER_HOUR) return false;
    const last = searches.at(-1);
    return last == null || at - last >= ECHO_SEARCH_SPACING_MS;
  }

  function remember<T>(map: Map<string, T>, key: string, value: T) {
    map.delete(key);
    map.set(key, value);
    while (map.size > MAX_MISSES) map.delete(map.keys().next().value!);
  }

  return {
    async match(userId: number, song: EchoSong): Promise<EchoMatch> {
      const key = songKey(song.artist, song.title);
      const known = await fromCatalogue(userId, key, song.durationMs);
      if (known) return { videoId: known, via: "catalogue" };
      const searched = found.get(key);
      if (searched) return { videoId: searched, via: "catalogue" };
      const at = now();
      const missedAt = misses.get(key);
      if (missedAt != null && at - missedAt < ECHO_MISS_TTL_MS) return { videoId: null, reason: "recent-miss" };
      if (!searchAllowed(at)) return { videoId: null, reason: "rate-limited" };
      searches.push(at);
      let results: MusicTrack[];
      try {
        const artist = song.artist.split(/,|&|\bx\b/i)[0].trim() || song.artist;
        results = await dependencies.search(userId, `${artist} ${song.title}`.slice(0, 200));
      } catch (error) {
        return { videoId: null, reason: "search-failed", error: error instanceof Error ? error.message : String(error) };
      }
      const accepted = results.filter((track) => acceptsSearchResult(song, track));
      if (!accepted.length) {
        remember(misses, key, at);
        return { videoId: null, reason: "no-match" };
      }
      await dependencies.remember(accepted);
      // The search's tracks are in the catalogue now, so the same tie-breaks pick among them and any already there.
      const pick = await fromCatalogue(userId, key, song.durationMs)
        ?? best(accepted.map((track) => ({ ...track, known: false, disliked: false })), song.durationMs)!.videoId;
      remember(found, key, pick);
      return { videoId: pick, via: "search" };
    },
  };
}

export type EchoMatcher = ReturnType<typeof createEchoMatcher>;
