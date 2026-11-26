import { database } from "../database";
import type { MusicPlaylist } from "./youtubeMusicGenreParsers";

/** A profile's own playlists and the YouTube Music playlists it saved. Every query is scoped to the profile. */

export const USER_PLAYLIST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MAX_PLAYLISTS = 500;
export const MAX_PLAYLIST_TRACKS = 1000;
export const MAX_TITLE = 150;

export interface UserPlaylist {
  id: string;
  title: string;
  trackCount: number;
  /** The first song's artwork, for the library card. */
  thumbnail: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedPlaylist extends MusicPlaylist {
  savedAt: string;
}

interface PlaylistRow { id: string; title: string; created_at: string; updated_at: string; track_count: number; thumbnail: string | null }

const now = () => new Date().toISOString();

/** A title as stored: trimmed, one line, at most `MAX_TITLE` characters; null when empty. */
export function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  return title || null;
}

const SELECT_PLAYLISTS = `
  SELECT p.id, p.title, p.created_at, p.updated_at,
    (SELECT COUNT(*) FROM music_playlist_tracks t WHERE t.playlist_id = p.id) AS track_count,
    (SELECT m.thumbnail FROM music_playlist_tracks t JOIN music_tracks m ON m.video_id = t.video_id
      WHERE t.playlist_id = p.id ORDER BY t.position, t.video_id LIMIT 1) AS thumbnail
  FROM music_playlists p`;

function fromRow(row: PlaylistRow): UserPlaylist {
  return { id: row.id, title: row.title, trackCount: Number(row.track_count), thumbnail: row.thumbnail ?? "", createdAt: row.created_at, updatedAt: row.updated_at };
}

/** The profile's playlists, most recently changed first. */
export async function userPlaylists(userId: number): Promise<UserPlaylist[]> {
  const rows = await database.prepare(`${SELECT_PLAYLISTS} WHERE p.user_id = ? ORDER BY p.updated_at DESC, p.id LIMIT ${MAX_PLAYLISTS}`).all<PlaylistRow>(userId);
  return rows.map(fromRow);
}

/** One of the profile's playlists, or null when it is missing or another profile's. */
export async function userPlaylist(userId: number, id: string): Promise<UserPlaylist | null> {
  if (!USER_PLAYLIST_ID.test(id)) return null;
  const row = await database.prepare(`${SELECT_PLAYLISTS} WHERE p.user_id = ? AND p.id = ?`).get<PlaylistRow>(userId, id);
  return row ? fromRow(row) : null;
}

/** The playlist's songs' video IDs, in order. */
export async function playlistTrackIds(playlistId: string): Promise<string[]> {
  const rows = await database.prepare("SELECT video_id FROM music_playlist_tracks WHERE playlist_id = ? ORDER BY position, video_id")
    .all<{ video_id: string }>(playlistId);
  return rows.map((row) => row.video_id);
}

export async function createPlaylist(userId: number, title: string): Promise<UserPlaylist | null> {
  const count = await database.prepare("SELECT COUNT(*) AS n FROM music_playlists WHERE user_id = ?").get<{ n: number }>(userId);
  if (Number(count?.n ?? 0) >= MAX_PLAYLISTS) return null;
  const id = crypto.randomUUID();
  const at = now();
  await database.prepare("INSERT INTO music_playlists (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, userId, title, at, at);
  return userPlaylist(userId, id);
}

const touch = (id: string) => database.prepare("UPDATE music_playlists SET updated_at = ? WHERE id = ?").run(now(), id);

export async function renamePlaylist(userId: number, id: string, title: string): Promise<boolean> {
  if (!await userPlaylist(userId, id)) return false;
  await database.prepare("UPDATE music_playlists SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(title, now(), id, userId);
  return true;
}

export async function deletePlaylist(userId: number, id: string): Promise<boolean> {
  if (!await userPlaylist(userId, id)) return false;
  await database.transaction(async () => {
    await database.prepare("DELETE FROM music_playlist_tracks WHERE playlist_id = ?").run(id);
    await database.prepare("DELETE FROM music_playlists WHERE id = ? AND user_id = ?").run(id, userId);
  })();
  return true;
}

export type AddResult = "added" | "present" | "full" | "missing";

/** Adds a song at the end. A song already in the playlist stays where it is. */
export async function addPlaylistTrack(userId: number, id: string, videoId: string): Promise<AddResult> {
  const playlist = await userPlaylist(userId, id);
  if (!playlist) return "missing";
  if (await database.prepare("SELECT 1 AS present FROM music_playlist_tracks WHERE playlist_id = ? AND video_id = ?").get(id, videoId)) return "present";
  if (playlist.trackCount >= MAX_PLAYLIST_TRACKS) return "full";
  const last = await database.prepare("SELECT MAX(position) AS position FROM music_playlist_tracks WHERE playlist_id = ?").get<{ position: number | null }>(id);
  const position = last?.position == null ? 0 : Number(last.position) + 1;
  await database.prepare("INSERT INTO music_playlist_tracks (playlist_id, video_id, position, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(playlist_id, video_id) DO NOTHING")
    .run(id, videoId, position, now());
  await touch(id);
  return "added";
}

export interface AddManyResult { added: number; present: number; full: number }

/**
 * Adds several songs at the end, in the given order: an album or another
 * playlist. Songs already there stay where they are, and songs past
 * `MAX_PLAYLIST_TRACKS` are left out and counted as `full`.
 */
export async function addPlaylistTracks(userId: number, id: string, videoIds: readonly string[]): Promise<AddManyResult | "missing"> {
  const playlist = await userPlaylist(userId, id);
  if (!playlist) return "missing";
  const existing = new Set(await playlistTrackIds(id));
  const wanted = [...new Set(videoIds)];
  const fresh = wanted.filter((videoId) => !existing.has(videoId));
  const room = Math.max(0, MAX_PLAYLIST_TRACKS - existing.size);
  const adding = fresh.slice(0, room);
  if (adding.length) {
    const last = await database.prepare("SELECT MAX(position) AS position FROM music_playlist_tracks WHERE playlist_id = ?").get<{ position: number | null }>(id);
    const start = last?.position == null ? 0 : Number(last.position) + 1;
    const at = now();
    await database.transaction(async () => {
      const insert = database.prepare("INSERT INTO music_playlist_tracks (playlist_id, video_id, position, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(playlist_id, video_id) DO NOTHING");
      for (const [offset, videoId] of adding.entries()) await insert.run(id, videoId, start + offset, at);
    })();
    await touch(id);
  }
  return { added: adding.length, present: wanted.length - fresh.length, full: fresh.length - adding.length };
}

export async function removePlaylistTrack(userId: number, id: string, videoId: string): Promise<boolean> {
  if (!await userPlaylist(userId, id)) return false;
  await database.prepare("DELETE FROM music_playlist_tracks WHERE playlist_id = ? AND video_id = ?").run(id, videoId);
  await touch(id);
  return true;
}

/**
 * Puts the playlist's songs in the given order. `order` must name exactly the
 * songs the playlist has, so a stale order from another device is refused
 * rather than dropping or reviving songs.
 */
export async function reorderPlaylist(userId: number, id: string, order: readonly string[]): Promise<"ok" | "missing" | "mismatch"> {
  if (!await userPlaylist(userId, id)) return "missing";
  const current = await playlistTrackIds(id);
  const wanted = new Set(order);
  if (wanted.size !== order.length || order.length !== current.length || current.some((videoId) => !wanted.has(videoId))) return "mismatch";
  await database.transaction(async () => {
    const update = database.prepare("UPDATE music_playlist_tracks SET position = ? WHERE playlist_id = ? AND video_id = ?");
    for (const [position, videoId] of order.entries()) await update.run(position, id, videoId);
  })();
  await touch(id);
  return "ok";
}

interface SavedPlaylistRow { playlist_id: string; title: string; subtitle: string; thumbnail: string; saved_at: string }

/** YouTube Music playlists the profile saved, newest first. Each keeps its details, so the library shows without YouTube. */
export async function savedPlaylists(userId: number): Promise<SavedPlaylist[]> {
  const rows = await database.prepare("SELECT * FROM music_saved_playlists WHERE user_id = ? ORDER BY saved_at DESC, playlist_id LIMIT 500")
    .all<SavedPlaylistRow>(userId);
  return rows.map((row) => ({ playlistId: row.playlist_id, title: row.title, subtitle: row.subtitle, thumbnail: row.thumbnail, savedAt: row.saved_at }));
}

export async function isPlaylistSaved(userId: number, playlistId: string): Promise<boolean> {
  return Boolean(await database.prepare("SELECT 1 AS saved FROM music_saved_playlists WHERE user_id = ? AND playlist_id = ?").get(userId, playlistId));
}

export async function savePlaylist(userId: number, playlist: MusicPlaylist, savedAt = now()): Promise<void> {
  await database.prepare(`
    INSERT INTO music_saved_playlists (user_id, playlist_id, title, subtitle, thumbnail, saved_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, playlist_id) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle, thumbnail = excluded.thumbnail
  `).run(userId, playlist.playlistId, playlist.title, playlist.subtitle, playlist.thumbnail, savedAt);
}

export async function unsavePlaylist(userId: number, playlistId: string): Promise<void> {
  await database.prepare("DELETE FROM music_saved_playlists WHERE user_id = ? AND playlist_id = ?").run(userId, playlistId);
}
