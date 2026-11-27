import { createHash } from "node:crypto";
import { database } from "../database";
import { songKey } from "./musicCatalog";
import { ALBUM_ID, ARTIST_ID } from "./youtubeMusicBrowseParsers";
import { MAX_PLAYLIST_TRACKS, MAX_TITLE, playlistTrackIds, USER_PLAYLIST_ID } from "./musicPlaylists";
import { PLAYLIST_ID } from "./youtubeMusicGenreParsers";

/**
 * Portable backup for music mode (section `profile.music`). Ratings, plays,
 * saved albums (since schema v2), and the profile's own playlists and saved YouTube Music playlists (since
 * v3) and songs heard on an Echo that matched no track (since v4) are portable personal state. Track rows are a rebuildable cache; only those
 * the profile's ratings, plays and playlists point at travel with them, so a restored
 * library can still show titles before the songs are seen again.
 */
export const MUSIC_BACKUP_SECTION = {
  id: "profile.music", schemaVersion: 4, scope: "profile" as const, sensitivity: "personal" as const, dependencies: ["profiles.index"],
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
  /** Added in schema v3; absent from older documents. `tracks` lists video IDs in playlist order. */
  playlists?: Array<{ id: string; title: string; created_at: string; updated_at: string; tracks: string[] }>;
  saved_playlists?: Array<{ playlist_id: string; title: string; subtitle: string; thumbnail: string; saved_at: string }>;
  /** Added in schema v4; absent from older documents. Echo songs with no YouTube Music track, keyed by song and start time. */
  echo_plays?: Array<{ song_key: string; title: string; artist: string; album: string | null; art: string; started_at: string; listened_seconds: number; duration: number | null; end_reason: string }>;
}

export async function exportMusicBackup(userId: number): Promise<MusicBackupDocument> {
  const ratings = await database.prepare("SELECT video_id, rating, rated_at FROM music_ratings WHERE user_id = ? ORDER BY rated_at, video_id")
    .all<MusicBackupDocument["ratings"][number]>(userId);
  const plays = await database.prepare("SELECT video_id, started_at, listened_seconds, duration, end_reason, station_seed FROM music_plays WHERE user_id = ? ORDER BY started_at, id")
    .all<MusicBackupDocument["plays"][number]>(userId);
  const tracks = await database.prepare(`
    SELECT video_id, title, artist, artist_id, album, duration, thumbnail, is_topic FROM music_tracks
    WHERE video_id IN (SELECT video_id FROM music_ratings WHERE user_id = ? UNION SELECT video_id FROM music_plays WHERE user_id = ?
      UNION SELECT t.video_id FROM music_playlist_tracks t JOIN music_playlists p ON p.id = t.playlist_id WHERE p.user_id = ?)
    ORDER BY video_id
  `).all<MusicBackupDocument["tracks"][number]>(userId, userId, userId);
  const saved_albums = await database.prepare("SELECT browse_id, title, artist, artist_id, year, thumbnail, kind, saved_at FROM music_saved_albums WHERE user_id = ? ORDER BY saved_at, browse_id")
    .all<NonNullable<MusicBackupDocument["saved_albums"]>[number]>(userId);
  const playlistRows = await database.prepare("SELECT id, title, created_at, updated_at FROM music_playlists WHERE user_id = ? ORDER BY created_at, id")
    .all<Omit<NonNullable<MusicBackupDocument["playlists"]>[number], "tracks">>(userId);
  const playlists = [];
  for (const row of playlistRows) playlists.push({ ...row, tracks: await playlistTrackIds(row.id) });
  const saved_playlists = await database.prepare("SELECT playlist_id, title, subtitle, thumbnail, saved_at FROM music_saved_playlists WHERE user_id = ? ORDER BY saved_at, playlist_id")
    .all<NonNullable<MusicBackupDocument["saved_playlists"]>[number]>(userId);
  const echo_plays = await database.prepare("SELECT song_key, title, artist, album, art, started_at, listened_seconds, duration, end_reason FROM music_echo_plays WHERE user_id = ? ORDER BY started_at, song_key")
    .all<NonNullable<MusicBackupDocument["echo_plays"]>[number]>(userId);
  return { tracks, ratings, plays, saved_albums, playlists, saved_playlists, echo_plays };
}

const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";
const optionalText = (value: unknown, max: number) => typeof value === "string" && value ? value.slice(0, max) : null;
const validTime = (value: unknown) => typeof value === "string" && !Number.isNaN(new Date(value).getTime());

/** A stable playlist ID for a copy of `id` restored into another profile. */
function profilePlaylistId(id: string, userId: number): string {
  const hex = createHash("sha256").update(`${id}:${userId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Restore one profile's music. Safe to run twice; `replace` first clears that profile's music library and history. */
export async function restoreMusicBackup(userId: number, value: unknown, strategy: string): Promise<{ skipped: number }> {
  const doc = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof MusicBackupDocument, unknown>>;
  let skipped = 0;
  if (strategy === "replace") {
    await database.prepare("DELETE FROM music_ratings WHERE user_id = ?").run(userId);
    await database.prepare("DELETE FROM music_plays WHERE user_id = ?").run(userId);
    await database.prepare("DELETE FROM music_saved_albums WHERE user_id = ?").run(userId);
    await database.prepare("DELETE FROM music_playlist_tracks WHERE playlist_id IN (SELECT id FROM music_playlists WHERE user_id = ?)").run(userId);
    await database.prepare("DELETE FROM music_playlists WHERE user_id = ?").run(userId);
    await database.prepare("DELETE FROM music_saved_playlists WHERE user_id = ?").run(userId);
    await database.prepare("DELETE FROM music_echo_plays WHERE user_id = ?").run(userId);
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
    `).run(userId, row.video_id, row.started_at, listened, duration, row.end_reason, optionalText(row.station_seed, 80));
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
  for (const row of Array.isArray(doc.playlists) ? doc.playlists as any[] : []) {
    const title = typeof row?.title === "string" ? row.title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) : "";
    if (!USER_PLAYLIST_ID.test(row?.id ?? "") || !title) { skipped++; continue; }
    // A backup restored into a second profile meets its own playlist IDs on the first; the copy gets an ID derived
    // from both, so restoring again finds it instead of adding another.
    let id: string = row.id;
    let owner = await database.prepare("SELECT user_id FROM music_playlists WHERE id = ?").get<{ user_id: number }>(id);
    if (owner && Number(owner.user_id) !== userId) {
      id = profilePlaylistId(id, userId);
      owner = await database.prepare("SELECT user_id FROM music_playlists WHERE id = ?").get<{ user_id: number }>(id);
    }
    // Merge keeps a playlist the profile already has as it is.
    if (owner) continue;
    const createdAt = validTime(row.created_at) ? row.created_at : new Date().toISOString();
    await database.prepare("INSERT INTO music_playlists (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, userId, title, createdAt, validTime(row.updated_at) ? row.updated_at : createdAt);
    const songs = [...new Set((Array.isArray(row.tracks) ? row.tracks : []).filter((videoId: unknown) => typeof videoId === "string" && VIDEO_ID.test(videoId)))]
      .slice(0, MAX_PLAYLIST_TRACKS) as string[];
    for (const [position, videoId] of songs.entries()) {
      await database.prepare("INSERT INTO music_playlist_tracks (playlist_id, video_id, position, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(playlist_id, video_id) DO NOTHING")
        .run(id, videoId, position, createdAt);
    }
  }
  for (const row of Array.isArray(doc.saved_playlists) ? doc.saved_playlists as any[] : []) {
    if (!PLAYLIST_ID.test(row?.playlist_id ?? "")) { skipped++; continue; }
    await database.prepare(`
      INSERT INTO music_saved_playlists (user_id, playlist_id, title, subtitle, thumbnail, saved_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, playlist_id) DO NOTHING
    `).run(userId, row.playlist_id, text(row.title, 500), text(row.subtitle, 500), text(row.thumbnail, 2000),
      validTime(row.saved_at) ? row.saved_at : new Date().toISOString());
  }
  for (const row of Array.isArray(doc.echo_plays) ? doc.echo_plays as any[] : []) {
    const listened = Number(row?.listened_seconds);
    const key = typeof row?.song_key === "string" ? row.song_key.slice(0, 1000) : "";
    if (!key.includes("|") || !validTime(row.started_at) || !Number.isFinite(listened) || listened < 0 || !END_REASONS.has(row.end_reason)) {
      skipped++;
      continue;
    }
    const duration = row.duration == null || !Number.isFinite(Number(row.duration)) ? null : Number(row.duration);
    await database.prepare(`
      INSERT INTO music_echo_plays (user_id, song_key, title, artist, album, art, started_at, listened_seconds, duration, end_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, song_key, started_at) DO NOTHING
    `).run(userId, key, text(row.title, 500), text(row.artist, 500), optionalText(row.album, 500), text(row.art, 2000),
      row.started_at, listened, duration, row.end_reason);
  }
  return { skipped };
}
