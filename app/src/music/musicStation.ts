import { database } from "../database";
import { musicTracks, upsertMusicTracks, type StoredMusicTrack } from "./musicCatalog";
import { artistKey, pickStationTracks, type MusicPlaySignal, type MusicSignals } from "./musicStationRanking";
import type { MusicTrack, YouTubeMusicClient } from "./youtubeMusicClient";

export type StationSeed =
  | { kind: "track"; videoId: string }
  | { kind: "liked" }
  | { kind: "mix" };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const RADIO_TTL_MS = 30 * 60_000;
const RADIO_CACHE_LIMIT = 500;
const LIKED_RADIO_EVERY = 5;
const PLAY_HISTORY_LIMIT = 500;

export function parseStationSeed(value: unknown): StationSeed | null {
  const seed = value as { kind?: unknown; videoId?: unknown } | null;
  if (seed?.kind === "liked" || seed?.kind === "mix") return { kind: seed.kind };
  if (seed?.kind === "track" && typeof seed.videoId === "string" && VIDEO_ID.test(seed.videoId)) {
    return { kind: "track", videoId: seed.videoId };
  }
  return null;
}

export function stationSeedKey(seed: StationSeed): string {
  return seed.kind === "track" ? `track:${seed.videoId}` : seed.kind;
}

export function parseVideoIdList(value: unknown, limit = 500): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string" && VIDEO_ID.test(id)).slice(-limit);
}

export async function loadMusicSignals(userId: number): Promise<MusicSignals> {
  const ratingRows = await database.prepare("SELECT video_id, rating FROM music_ratings WHERE user_id = ?")
    .all<{ video_id: string; rating: number }>(userId);
  const playRows = await database.prepare(`
    SELECT p.video_id, p.end_reason, p.listened_seconds, t.song_key, t.artist_id, t.artist
    FROM music_plays p LEFT JOIN music_tracks t ON t.video_id = p.video_id
    WHERE p.user_id = ? ORDER BY p.started_at DESC LIMIT ${PLAY_HISTORY_LIMIT}
  `).all<{ video_id: string; end_reason: MusicPlaySignal["endReason"]; listened_seconds: number; song_key: string | null; artist_id: string | null; artist: string | null }>(userId);
  return {
    ratings: new Map(ratingRows.map((row) => [row.video_id, Number(row.rating)])),
    plays: playRows.map((row) => ({
      videoId: row.video_id,
      songKey: row.song_key || null,
      artistKey: row.artist_id || row.artist ? artistKey({ artistId: row.artist_id, artist: row.artist ?? "" }) : null,
      endReason: row.end_reason,
      listenedSeconds: Number(row.listened_seconds) || 0,
    })),
  };
}

async function likedVideoIds(userId: number, limit = 50): Promise<string[]> {
  const rows = await database.prepare("SELECT video_id FROM music_ratings WHERE user_id = ? AND rating = 1 ORDER BY rated_at DESC LIMIT ?")
    .all<{ video_id: string }>(userId, limit);
  return rows.map((row) => row.video_id);
}

async function mostPlayedVideoIds(userId: number, limit = 20): Promise<string[]> {
  const rows = await database.prepare(`
    SELECT video_id, COUNT(*) AS plays FROM music_plays
    WHERE user_id = ? AND end_reason = 'completed'
    GROUP BY video_id ORDER BY plays DESC, MAX(started_at) DESC LIMIT ?
  `).all<{ video_id: string }>(userId, limit);
  return rows.map((row) => row.video_id);
}

export function createMusicStations(client: YouTubeMusicClient) {
  const radioCache = new Map<string, { at: number; tracks: StoredMusicTrack[] }>();

  async function radioFor(userId: number, videoId: string): Promise<StoredMusicTrack[]> {
    const cached = radioCache.get(videoId);
    if (cached && Date.now() - cached.at < RADIO_TTL_MS) return cached.tracks;
    let tracks: StoredMusicTrack[];
    try {
      tracks = await upsertMusicTracks(await client.radio(userId, videoId));
    } catch (error) {
      if (cached) return cached.tracks;
      throw error;
    }
    radioCache.delete(videoId);
    radioCache.set(videoId, { at: Date.now(), tracks });
    while (radioCache.size > RADIO_CACHE_LIMIT) radioCache.delete(radioCache.keys().next().value!);
    return tracks;
  }

  function ordered(ids: readonly string[], known: ReadonlyMap<string, StoredMusicTrack>): StoredMusicTrack[] {
    return ids.map((id) => known.get(id)).filter((track): track is StoredMusicTrack => Boolean(track));
  }

  /** The next `count` songs for a station, given what this session already played and skipped. */
  async function next(userId: number, seed: StationSeed, servedIds: readonly string[], skippedIds: readonly string[], count = 10): Promise<StoredMusicTrack[]> {
    const liked = await likedVideoIds(userId);
    const known = await musicTracks([...servedIds, ...liked]);
    const served = ordered(servedIds, known);
    const skipped = new Set(skippedIds);
    const radioSeeds: string[] = [];
    const sources: StoredMusicTrack[][] = [];

    if (seed.kind === "track") {
      radioSeeds.push(seed.videoId);
    } else {
      const base = seed.kind === "liked" ? liked : await mostPlayedVideoIds(userId);
      sources.push(ordered(base, seed.kind === "liked" ? known : await musicTracks(base)));
      if (base.length) radioSeeds.push(base[Math.floor(served.length / LIKED_RADIO_EVERY) % base.length]);
    }
    // Let the station drift with the listener: follow the last song they kept listening to.
    const lastKept = [...served].reverse().find((track) => !skipped.has(track.videoId));
    if (lastKept) radioSeeds.push(lastKept.videoId);
    // Every few songs, pull from the radio of something the profile liked.
    if (liked.length && served.length && served.length % LIKED_RADIO_EVERY === 0) {
      radioSeeds.push(liked[(served.length / LIKED_RADIO_EVERY) % liked.length]);
    }

    for (const videoId of new Set(radioSeeds)) {
      try {
        sources.push(await radioFor(userId, videoId));
      } catch (error) {
        // A failed expansion radio is survivable; the seed's own radio is not.
        if (seed.kind === "track" && videoId === seed.videoId && !sources.length) throw error;
      }
    }
    const signals = await loadMusicSignals(userId);
    // A station started from a song opens with that song.
    const opener = seed.kind === "track" && !served.length
      ? sources.flat().find((track) => track.videoId === seed.videoId) ?? (await musicTracks([seed.videoId])).get(seed.videoId)
      : undefined;
    if (!opener) return pickStationTracks(sources, signals, { served, skipped }, count);
    return [opener, ...pickStationTracks(sources, signals, { served: [opener], skipped }, count - 1)];
  }

  return { next };
}

export type MusicStations = ReturnType<typeof createMusicStations>;
export type { MusicTrack };
