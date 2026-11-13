import type { StoredMusicTrack } from "./musicCatalog";

export const QUICK_SKIP_SECONDS = 30;
export const RECENT_PLAY_WINDOW = 50;
export const ARTIST_COOLDOWN = 3;

export interface MusicPlaySignal {
  videoId: string;
  songKey: string | null;
  artistKey: string | null;
  endReason: "completed" | "skipped" | "stopped";
  listenedSeconds: number;
}

export interface MusicSignals {
  /** videoId → 1 (liked) or -1 (not this one). */
  ratings: ReadonlyMap<string, number>;
  /** The profile's plays, newest first. */
  plays: readonly MusicPlaySignal[];
}

export interface StationSession {
  /** Tracks already handed to the player this session, oldest first. */
  served: readonly StoredMusicTrack[];
  /** Video ids skipped this session. */
  skipped: ReadonlySet<string>;
}

export function artistKey(track: Pick<StoredMusicTrack, "artist" | "artistId">): string {
  return track.artistId || track.artist.toLowerCase().trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface SongStats { completed: number; quickSkips: number }

function playStats(plays: readonly MusicPlaySignal[]) {
  const songs = new Map<string, SongStats>();
  const artists = new Map<string, number>();
  for (const play of plays) {
    const quickSkip = play.endReason === "skipped" && play.listenedSeconds < QUICK_SKIP_SECONDS;
    if (play.songKey) {
      const stats = songs.get(play.songKey) ?? { completed: 0, quickSkips: 0 };
      if (play.endReason === "completed") stats.completed++;
      if (quickSkip) stats.quickSkips++;
      songs.set(play.songKey, stats);
    }
    if (play.artistKey) {
      const delta = play.endReason === "completed" ? 1 : quickSkip ? -1 : 0;
      artists.set(play.artistKey, (artists.get(play.artistKey) ?? 0) + delta);
    }
  }
  return { songs, artists };
}

/** How much a profile wants this candidate now; higher plays sooner. Pure, for testing. */
export function scoreCandidate(
  track: StoredMusicTrack,
  sourceRank: number,
  sourceSize: number,
  signals: MusicSignals,
  stats: ReturnType<typeof playStats>,
  sessionSkippedArtists: ReadonlySet<string>,
): number {
  let score = sourceSize > 1 ? 1 - sourceRank / sourceSize : 1;
  if (signals.ratings.get(track.videoId) === 1) score += 0.6;
  const song = stats.songs.get(track.songKey);
  if (song) {
    score += Math.min(song.completed, 3) * 0.1;
    score -= song.quickSkips * 0.5;
  }
  score += clamp((stats.artists.get(artistKey(track)) ?? 0) * 0.1, -0.5, 0.5);
  if (sessionSkippedArtists.has(artistKey(track))) score -= 0.4;
  if (track.isTopic) score += 0.15;
  return score;
}

/**
 * Choose the next `count` tracks from radio candidates (each list in the order
 * YouTube gave it). Drops "not this one", anything already played this session,
 * other uploads of the same song, and recently played songs; keeps an artist out
 * for ARTIST_COOLDOWN tracks after it plays.
 */
export function pickStationTracks(
  sources: readonly (readonly StoredMusicTrack[])[],
  signals: MusicSignals,
  session: StationSession,
  count: number,
): StoredMusicTrack[] {
  const stats = playStats(signals.plays);
  const servedIds = new Set(session.served.map((track) => track.videoId));
  const servedSongs = new Set(session.served.map((track) => track.songKey));
  const sessionSkippedArtists = new Set(session.served.filter((track) => session.skipped.has(track.videoId)).map(artistKey));
  const recentSongs = new Set(signals.plays.slice(0, RECENT_PLAY_WINDOW).map((play) => play.songKey).filter(Boolean) as string[]);

  const best = new Map<string, { track: StoredMusicTrack; score: number }>();
  for (const source of sources) {
    source.forEach((track, rank) => {
      if (servedIds.has(track.videoId) || servedSongs.has(track.songKey)) return;
      if (signals.ratings.get(track.videoId) === -1) return;
      const score = scoreCandidate(track, rank, source.length, signals, stats, sessionSkippedArtists);
      const existing = best.get(track.songKey);
      if (!existing || score > existing.score) best.set(track.songKey, { track, score });
    });
  }

  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  // Prefer songs not heard lately; fall back to them only when the pool runs dry.
  const fresh = ranked.filter((entry) => !recentSongs.has(entry.track.songKey));
  const ordered = fresh.length >= count ? fresh : [...fresh, ...ranked.filter((entry) => recentSongs.has(entry.track.songKey))];

  const picked: StoredMusicTrack[] = [];
  const recentArtists = session.served.slice(-ARTIST_COOLDOWN).map(artistKey);
  const remaining = [...ordered];
  while (picked.length < count && remaining.length) {
    const cooling = new Set(recentArtists.slice(-ARTIST_COOLDOWN));
    let index = remaining.findIndex((entry) => !cooling.has(artistKey(entry.track)));
    // Every remaining song is by a cooling artist: take the best rather than stall.
    if (index < 0) index = 0;
    const [entry] = remaining.splice(index, 1);
    picked.push(entry.track);
    recentArtists.push(artistKey(entry.track));
  }
  return picked;
}
