import { database } from "../database";
import { songKey } from "./musicCatalog";
import { ALBUM_ID, ARTIST_ID } from "./youtubeMusicBrowseParsers";

/**
 * Portable backup for music mode (section `profile.music`). Ratings, plays and
 * saved albums (since schema v2) are portable personal state. Track rows are a rebuildable cache; only those
 * the profile's ratings and plays point at travel with them, so a restored
 * library can still show titles before the songs are seen again.
 */
export const MUSIC_BACKUP_SECTION = {
  id: "profile.music", schemaVersion: 2, scope: "profile" as const, sensitivity: "personal" as const, dependencies: ["profiles.index"],
  category: "personal" as const, path: (uuid = "") => `profiles/${uuid}/music.json`,
};

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const END_REASONS = new Set(["completed", "skipped", "stopped"]);

export interface MusicBackupDocument {
  tracks: Array<{ video_id: string; title: string; artist: string; artist_id: string | null; album: string | null; duration: number | null; thumbnail: string; is_topic: number }>;
  ratings: Array<{ video_id: string; rating: number; rated_at: string }>;
  plays: Array<{ video_id: string; started_at: string; listened_seconds: number; duration: number | null; end_reason: string; station_seed: string | null }>;
  /** Added in schema v2; absent from v1 documents. */
  saved_albums?: Array<{ browse_id: string; title: string; artist: string; artist_id: string | null; year: string | null; thumbnail: string; kind: string; saved_at: string }>;
}

export async function exportMusicBackup(userId: number): Promise<MusicBackupDocument> {
  const ratings = await database.prepare("SELECT video_id, rating, rated_at FROM music_ratings WHERE user_id = ? ORDER BY rated_at, video_id")
    .all<MusicBackupDocument["ratings"][number]>(userId);
  const plays = await database.prepare("SELECT video_id, started_at, listened_seconds, duration, end_reason, station_seed FROM music_plays WHERE user_id = ? ORDER BY started_at, id")
    .all<MusicBackupDocument["plays"][number]>(userId);
  const tracks = await database.prepare(`
    SELECT video_id, title, artist, artist_id, album, duration, thumbnail, is_topic FROM music_tracks
    WHERE video_id IN (SELECT video_id FROM music_ratings WHERE user_id = ? UNION SELECT video_id FROM music_plays WHERE user_id = ?)
    ORDER BY video_id
  `).all<MusicBackupDocument["tracks"][number]>(userId, userId);
  const saved_albums = await database.prepare("SELECT browse_id, title, artist, artist_id, year, thumbnail, kind, saved_at FROM music_saved_albums WHERE user_id = ? ORDER BY saved_at, browse_id")
    .all<NonNullable<MusicBackupDocument["saved_albums"]>[number]>(userId);
  return { tracks, ratings, plays, saved_albums };
}

const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";
const optionalText = (value: unknown, max: number) => typeof value === "string" && value ? value.slice(0, max) : null;
const validTime = (value: unknown) => typeof value === "string" && !Number.isNaN(new Date(value).getTime());

/** Restore one profile's music. Safe to run twice; `replace` first clears that profile's ratings and plays. */
export async function restoreMusicBackup(userId: number, value: unknown, strategy: string): Promise<{ skipped: number }> {
  const doc = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof MusicBackupDocument, unknown>>;
  let skipped = 0;
  if (strategy === "replace") {
    await database.prepare("DELETE FROM music_ratings WHERE user_id = ?").run(userId);
    await database.prepare("DELETE FROM music_plays WHERE user_id = ?").run(userId);
    await database.prepare("DELETE FROM music_saved_albums WHERE user_id = ?").run(userId);
  }
  for (const row of Array.isArray(doc.tracks) ? doc.tracks as any[] : []) {
    if (!VIDEO_ID.test(row?.video_id ?? "")) { skipped++; continue; }
    const title = text(row.title, 500);
    const artist = text(row.artist, 500);
    const duration = Number.isFinite(Number(row.duration)) && row.duration !== null ? Math.max(0, Math.floor(Number(row.duration))) : null;
    await database.prepare(`
      INSERT INTO music_tracks (video_id, title, artist, artist_id, album, duration, thumbnail, is_topic, song_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(video_id) DO NOTHING
    `).run(row.video_id, title, artist, optionalText(row.artist_id, 100), optionalText(row.album, 500), duration,
      text(row.thumbnail, 2000), row.is_topic ? 1 : 0, songKey(artist, title));
  }
  for (const row of Array.isArray(doc.ratings) ? doc.ratings as any[] : []) {
    if (!VIDEO_ID.test(row?.video_id ?? "") || ![1, -1].includes(Number(row.rating))) { skipped++; continue; }
    await database.prepare(`
      INSERT INTO music_ratings (user_id, video_id, rating, rated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, video_id) DO UPDATE SET rating = excluded.rating, rated_at = excluded.rated_at
    `).run(userId, row.video_id, Number(row.rating), validTime(row.rated_at) ? row.rated_at : new Date().toISOString());
  }
  for (const row of Array.isArray(doc.plays) ? doc.plays as any[] : []) {
    const listened = Number(row?.listened_seconds);
    if (!VIDEO_ID.test(row?.video_id ?? "") || !validTime(row.started_at) || !Number.isFinite(listened) || listened < 0 || !END_REASONS.has(row.end_reason)) {
      skipped++;
      continue;
    }
    const duration = row.duration == null || !Number.isFinite(Number(row.duration)) ? null : Number(row.duration);
    await database.prepare(`
      INSERT INTO music_plays (user_id, video_id, started_at, listened_seconds, duration, end_reason, station_seed)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, video_id, started_at) DO NOTHING
    `).run(userId, row.video_id, row.started_at, listened, duration, row.end_reason, optionalText(row.station_seed, 40));
  }
  for (const row of Array.isArray(doc.saved_albums) ? doc.saved_albums as any[] : []) {
    if (!ALBUM_ID.test(row?.browse_id ?? "")) { skipped++; continue; }
    const artistId = typeof row.artist_id === "string" && ARTIST_ID.test(row.artist_id) ? row.artist_id : null;
    const year = typeof row.year === "string" && /^\d{4}$/.test(row.year) ? row.year : null;
    await database.prepare(`
      INSERT INTO music_saved_albums (user_id, browse_id, title, artist, artist_id, year, thumbnail, kind, saved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, browse_id) DO NOTHING
    `).run(userId, row.browse_id, text(row.title, 500), text(row.artist, 500), artistId, year, text(row.thumbnail, 2000),
      row.kind === "single" ? "single" : "album", validTime(row.saved_at) ? row.saved_at : new Date().toISOString());
  }
  return { skipped };
}
