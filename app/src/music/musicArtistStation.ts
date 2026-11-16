import type { MusicPages } from "./musicAlbums";
import type { StoredMusicTrack } from "./musicCatalog";
import type { MusicSignals } from "./musicStationRanking";

/** Albums (then singles) whose songs join an artist's top songs once those are queued. */
const ARTIST_ALBUM_LIMIT = 6;

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/**
 * The artist's own songs not yet played this session: each pool shuffled, in
 * pool order (top songs first, then album songs). Drops "not this one", songs
 * skipped or already played, and other uploads of a song already picked. Unlike
 * a station there's no artist cooldown, since every song is the same artist.
 * Pure, for testing.
 */
export function artistOnlyTracks(
  pools: readonly (readonly StoredMusicTrack[])[],
  signals: Pick<MusicSignals, "ratings">,
  session: { served: readonly StoredMusicTrack[]; servedIds: readonly string[]; skipped: ReadonlySet<string> },
  random: () => number = Math.random,
): StoredMusicTrack[] {
  const usedIds = new Set([...session.servedIds, ...session.skipped]);
  const usedSongs = new Set(session.served.map((track) => track.songKey));
  const picked: StoredMusicTrack[] = [];
  for (const pool of pools) {
    for (const track of shuffled(pool, random)) {
      if (usedIds.has(track.videoId) || usedSongs.has(track.songKey)) continue;
      if (signals.ratings.get(track.videoId) === -1) continue;
      usedIds.add(track.videoId);
      usedSongs.add(track.songKey);
      picked.push(track);
    }
  }
  return picked;
}

/**
 * The pools an artist play draws from: top songs, and, once the first batch is
 * queued, the songs on their albums and singles. The first batch skips the
 * album pages so playback starts quickly (Alexa waits only a few seconds).
 */
export async function artistSongPools(
  pages: MusicPages,
  userId: number,
  topSongs: readonly StoredMusicTrack[],
  albumIds: readonly string[],
  firstBatch: boolean,
): Promise<StoredMusicTrack[][]> {
  if (firstBatch) return [[...topSongs]];
  const albums = await Promise.all(albumIds.slice(0, ARTIST_ALBUM_LIMIT).map((id) => pages.album(userId, id).catch(() => null)));
  return [[...topSongs], albums.flatMap((page) => page?.tracks ?? [])];
}
