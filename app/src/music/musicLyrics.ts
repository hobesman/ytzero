import { isYouTubeRefusalError } from "../youtubeRateLimit";
import { createLrclibClient, type LrclibClient, type LrclibLyrics, type LyricLine } from "./lrclib";
import type { MusicTrack, YouTubeMusicClient } from "./youtubeMusicClient";
import type { YouTubeMusicLyrics } from "./youtubeMusicLyricsParsers";
import { songKey } from "./musicSongKey";

/** A song's lyrics as the music routes return them. */
export interface MusicLyrics {
  videoId: string;
  /** Time-synced lines, for highlighting the one being sung; null when only plain lyrics are known. */
  synced: LyricLine[] | null;
  plain: string | null;
  instrumental: boolean;
  /** Who to credit: "LRCLIB", or YouTube Music's own line such as "Source: Musixmatch". */
  source: string | null;
}

type LyricsSource = Pick<YouTubeMusicClient, "lyrics">;

const FOUND_TTL_MS = 24 * 3_600_000;
const MISSING_TTL_MS = 6 * 3_600_000;
const MAX_ENTRIES = 500;

/**
 * Lyrics for a song: synced ones from LRCLIB when it has them, otherwise
 * YouTube Music's plain lyrics, otherwise LRCLIB's plain ones. Answers are kept
 * in memory, keyed by song, so the cache is rebuilt by asking again; a lookup
 * that failed outright is not kept.
 */
export function createMusicLyrics({ client, lrclib = createLrclibClient(), now = Date.now }: { client: LyricsSource; lrclib?: LrclibClient; now?: () => number }) {
  const entries = new Map<string, { lyrics: MusicLyrics; expiresAt: number }>();
  const pending = new Map<string, Promise<MusicLyrics>>();

  async function look(userId: number, track: MusicTrack): Promise<MusicLyrics> {
    let failures = 0;
    let fromLrclib: LrclibLyrics | null = null;
    try { fromLrclib = await lrclib.find({ artist: track.artist, title: track.title, album: track.album, duration: track.duration }); }
    catch { failures++; }
    const base = { videoId: track.videoId };
    if (fromLrclib?.synced) return { ...base, synced: fromLrclib.synced, plain: fromLrclib.plain, instrumental: fromLrclib.instrumental, source: "LRCLIB" };
    let fromYouTube: YouTubeMusicLyrics | null = null;
    try { fromYouTube = await client.lyrics(userId, track.videoId); }
    catch (error) {
      if (isYouTubeRefusalError(error) && !fromLrclib) throw error;
      failures++;
    }
    if (fromYouTube) return { ...base, synced: null, plain: fromYouTube.text, instrumental: false, source: fromYouTube.source };
    if (fromLrclib) return { ...base, synced: null, plain: fromLrclib.plain, instrumental: fromLrclib.instrumental, source: "LRCLIB" };
    if (failures === 2) throw new Error("no lyrics service answered");
    return { ...base, synced: null, plain: null, instrumental: false, source: null };
  }

  function cached(key: string, look: () => Promise<MusicLyrics>): Promise<MusicLyrics> {
    const entry = entries.get(key);
    if (entry && entry.expiresAt > now()) return Promise.resolve(entry.lyrics);
    if (entry) entries.delete(key);
    const existing = pending.get(key);
    if (existing) return existing;
    const request = look().then((lyrics) => {
      const found = Boolean(lyrics.synced || lyrics.plain || lyrics.instrumental);
      entries.set(key, { lyrics, expiresAt: now() + (found ? FOUND_TTL_MS : MISSING_TTL_MS) });
      while (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next().value as string | undefined;
        if (!oldest) break;
        entries.delete(oldest);
      }
      return lyrics;
    }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
    pending.set(key, request);
    return request;
  }

  return {
    get(userId: number, track: MusicTrack): Promise<MusicLyrics> {
      return cached(track.videoId, () => look(userId, track));
    },

    /**
     * Lyrics for a song YT Zero has no track for (one an Echo plays from
     * Amazon Music, say): LRCLIB only, by artist, title and length. The answer
     * has no videoId.
     */
    bySong(song: { artist: string; title: string; duration: number | null }): Promise<MusicLyrics> {
      return cached(`song:${songKey(song.artist, song.title)}`, async () => {
        const found = await lrclib.find({ artist: song.artist, title: song.title, album: null, duration: song.duration });
        return found
          ? { videoId: "", synced: found.synced, plain: found.plain, instrumental: found.instrumental, source: "LRCLIB" }
          : { videoId: "", synced: null, plain: null, instrumental: false, source: null };
      });
    },
  };
}

export type MusicLyricsService = ReturnType<typeof createMusicLyrics>;
