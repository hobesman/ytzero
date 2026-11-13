import { database } from "../database";
import type { MusicAlbum } from "./youtubeMusicBrowseParsers";

export interface SavedAlbum extends MusicAlbum {
  savedAt: string;
}

interface SavedAlbumRow {
  browse_id: string; title: string; artist: string; artist_id: string | null; year: string | null;
  thumbnail: string; kind: string; saved_at: string;
}

function fromRow(row: SavedAlbumRow): SavedAlbum {
  return {
    browseId: row.browse_id, title: row.title, artist: row.artist, artistId: row.artist_id, year: row.year,
    thumbnail: row.thumbnail, kind: row.kind === "single" ? "single" : "album", savedAt: row.saved_at,
  };
}

/** The profile's saved albums, newest first. Each row keeps the album's details, so it shows without YouTube. */
export async function savedAlbums(userId: number): Promise<SavedAlbum[]> {
  const rows = await database.prepare("SELECT * FROM music_saved_albums WHERE user_id = ? ORDER BY saved_at DESC, browse_id LIMIT 500")
    .all<SavedAlbumRow>(userId);
  return rows.map(fromRow);
}

export async function isAlbumSaved(userId: number, browseId: string): Promise<boolean> {
  return Boolean(await database.prepare("SELECT 1 AS saved FROM music_saved_albums WHERE user_id = ? AND browse_id = ?").get(userId, browseId));
}

export async function saveAlbum(userId: number, album: MusicAlbum, savedAt = new Date().toISOString()): Promise<void> {
  await database.prepare(`
    INSERT INTO music_saved_albums (user_id, browse_id, title, artist, artist_id, year, thumbnail, kind, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, browse_id) DO UPDATE SET
      title = excluded.title, artist = excluded.artist, artist_id = excluded.artist_id, year = excluded.year,
      thumbnail = excluded.thumbnail, kind = excluded.kind
  `).run(userId, album.browseId, album.title, album.artist, album.artistId, album.year, album.thumbnail, album.kind, savedAt);
}

export async function unsaveAlbum(userId: number, browseId: string): Promise<void> {
  await database.prepare("DELETE FROM music_saved_albums WHERE user_id = ? AND browse_id = ?").run(userId, browseId);
}
