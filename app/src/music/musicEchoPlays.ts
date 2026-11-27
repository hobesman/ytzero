import { database } from "../database";
import type { AsyncDatabaseClient } from "../databaseClient";
import type { MusicPlayEndReason } from "./musicPlays";

/**
 * A song heard on an Echo through another service (Amazon Music, say) that YT
 * Zero found no YouTube Music track for. A matched song is an ordinary
 * music_plays row instead, so it counts towards mixes and stations.
 */
export interface MusicEchoPlay {
  songKey: string;
  title: string;
  artist: string;
  album: string | null;
  art: string;
  startedAt: Date;
  listenedSeconds: number;
  duration: number | null;
  endReason: MusicPlayEndReason;
}

export async function recordMusicEchoPlay(userId: number, play: MusicEchoPlay, db: AsyncDatabaseClient = database): Promise<void> {
  await db.prepare(`
    INSERT INTO music_echo_plays (user_id, song_key, title, artist, album, art, started_at, listened_seconds, duration, end_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, song_key, started_at) DO UPDATE SET
      listened_seconds = excluded.listened_seconds, duration = excluded.duration, end_reason = excluded.end_reason
  `).run(userId, play.songKey, play.title.slice(0, 500), play.artist.slice(0, 500), play.album?.slice(0, 500) ?? null,
    play.art.slice(0, 2000), play.startedAt.toISOString(), play.listenedSeconds, play.duration, play.endReason);
}

/**
 * Recently played as the library shows it: an unmatched Echo song is a track
 * with no audio, marked `playable: false`. Its `videoId` is only a list key,
 * never a YouTube ID.
 */
export interface UnplayableEchoTrack {
  videoId: string; title: string; artist: string; artistId: null; album: string | null; duration: number | null;
  thumbnail: string; isTopic: false; rating: 0; playable: false;
}

/** The newest unmatched Echo song per song, newest first, with when it was last heard. */
export async function recentMusicEchoPlays(userId: number, limit = 50, db: AsyncDatabaseClient = database): Promise<Array<{ track: UnplayableEchoTrack; lastPlayed: string; songKey: string }>> {
  const rows = await db.prepare(`
    SELECT p.song_key, p.title, p.artist, p.album, p.art, p.duration, p.started_at FROM music_echo_plays p
    JOIN (SELECT song_key, MAX(started_at) AS last_played FROM music_echo_plays WHERE user_id = ? GROUP BY song_key) latest
      ON latest.song_key = p.song_key AND latest.last_played = p.started_at
    WHERE p.user_id = ? ORDER BY p.started_at DESC LIMIT ?
  `).all<{ song_key: string; title: string; artist: string; album: string | null; art: string; duration: number | null; started_at: string }>(userId, userId, limit);
  return rows.map((row) => ({
    songKey: row.song_key,
    lastPlayed: row.started_at,
    track: {
      videoId: `echo:${row.song_key}`, title: row.title, artist: row.artist, artistId: null, album: row.album,
      duration: row.duration == null ? null : Math.round(Number(row.duration)), thumbnail: row.art, isTopic: false, rating: 0, playable: false,
    },
  }));
}

/**
 * Merges the library's played tracks (newest first, each with when it was last
 * played) with unmatched Echo songs. An Echo song the profile has since played
 * as a matched track is left out.
 */
export function mergeRecentWithEcho<T extends { videoId: string }>(
  played: Array<{ track: T; lastPlayed: string; songKey: string }>,
  echo: Array<{ track: UnplayableEchoTrack; lastPlayed: string; songKey: string }>,
  limit = 50,
): Array<T | UnplayableEchoTrack> {
  const playedKeys = new Set(played.map((entry) => entry.songKey));
  return [...played, ...echo.filter((entry) => !playedKeys.has(entry.songKey))]
    .sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed))
    .slice(0, limit)
    .map((entry) => entry.track);
}
