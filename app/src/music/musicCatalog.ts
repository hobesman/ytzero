import { database } from "../database";
import { songKey } from "./musicSongKey";
import type { MusicTrack } from "./youtubeMusicParsers";

export { songKey };

export interface StoredMusicTrack extends MusicTrack {
  songKey: string;
}

interface MusicTrackRow {
  video_id: string; title: string; artist: string; artist_id: string | null; album: string | null;
  duration: number | null; thumbnail: string; is_topic: number; song_key: string;
}

function fromRow(row: MusicTrackRow): StoredMusicTrack {
  return {
    videoId: row.video_id, title: row.title, artist: row.artist, artistId: row.artist_id, album: row.album,
    duration: row.duration, thumbnail: row.thumbnail, isTopic: Boolean(row.is_topic), songKey: row.song_key,
  };
}

export function withSongKey(track: MusicTrack): StoredMusicTrack {
  return { ...track, songKey: songKey(track.artist, track.title) };
}

/** Remember tracks seen in search or radio so plays and likes can show them later. */
export async function upsertMusicTracks(tracks: readonly MusicTrack[]): Promise<StoredMusicTrack[]> {
  const stored = tracks.map(withSongKey);
  const statement = database.prepare(`
    INSERT INTO music_tracks (video_id, title, artist, artist_id, album, duration, thumbnail, is_topic, song_key, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      artist_id = COALESCE(excluded.artist_id, music_tracks.artist_id),
      album = COALESCE(excluded.album, music_tracks.album),
      duration = COALESCE(excluded.duration, music_tracks.duration),
      thumbnail = CASE WHEN excluded.thumbnail = '' THEN music_tracks.thumbnail ELSE excluded.thumbnail END,
      is_topic = excluded.is_topic,
      song_key = excluded.song_key,
      updated_at = excluded.updated_at
  `);
  const now = new Date().toISOString();
  await database.transaction(async () => {
    for (const track of stored) {
      await statement.run(track.videoId, track.title, track.artist, track.artistId, track.album, track.duration,
        track.thumbnail, track.isTopic ? 1 : 0, track.songKey, now);
    }
  })();
  return stored;
}

export async function musicTrack(videoId: string): Promise<StoredMusicTrack | null> {
  const row = await database.prepare("SELECT * FROM music_tracks WHERE video_id = ?").get<MusicTrackRow>(videoId);
  return row ? fromRow(row) : null;
}

export async function musicTracks(videoIds: readonly string[]): Promise<Map<string, StoredMusicTrack>> {
  const out = new Map<string, StoredMusicTrack>();
  if (!videoIds.length) return out;
  const unique = [...new Set(videoIds)];
  for (let start = 0; start < unique.length; start += 200) {
    const chunk = unique.slice(start, start + 200);
    const rows = await database.prepare(`SELECT * FROM music_tracks WHERE video_id IN (${chunk.map(() => "?").join(",")})`)
      .all<MusicTrackRow>(...chunk);
    for (const row of rows) out.set(row.video_id, fromRow(row));
  }
  return out;
}
