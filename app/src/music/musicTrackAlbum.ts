import type { StoredMusicTrack } from "./musicCatalog";
import { songKey } from "./musicSongKey";
import type { MusicTrack } from "./youtubeMusicParsers";

/**
 * The album a song is on, as a YouTube Music browse ID, for opening it from
 * the room tablet's now playing. The catalog keeps only album names, so it is
 * looked up: the song's own entry at the head of its radio queue links its
 * album, and for a music video (whose entry usually doesn't) the album
 * track of the same song from a song search does. Kept a day, "none" too.
 */
export interface MusicTrackAlbumDependencies {
  radio: (userId: number, videoId: string) => Promise<MusicTrack[]>;
  search: (userId: number, query: string) => Promise<MusicTrack[]>;
  now?: () => number;
}

const ALBUM_TTL_MS = 24 * 60 * 60 * 1000;
const ALBUM_LIMIT = 1000;

export function createMusicTrackAlbum(dependencies: MusicTrackAlbumDependencies) {
  const now = dependencies.now ?? Date.now;
  const albums = new Map<string, { albumId: string | null; at: number }>();

  async function find(userId: number, track: StoredMusicTrack): Promise<string | null> {
    const queue = await dependencies.radio(userId, track.videoId).catch(() => [] as MusicTrack[]);
    const own = queue.find((item) => item.videoId === track.videoId)?.albumId;
    if (own) return own;
    const results = await dependencies.search(userId, `${track.artist} ${track.title}`).catch(() => [] as MusicTrack[]);
    return results.find((item) => item.albumId && item.isTopic && songKey(item.artist, item.title) === track.songKey)?.albumId ?? null;
  }

  return async function albumOf(userId: number, track: StoredMusicTrack): Promise<string | null> {
    const hit = albums.get(track.videoId);
    if (hit && now() - hit.at < ALBUM_TTL_MS) return hit.albumId;
    const albumId = await find(userId, track);
    albums.delete(track.videoId);
    albums.set(track.videoId, { albumId, at: now() });
    while (albums.size > ALBUM_LIMIT) albums.delete(albums.keys().next().value!);
    return albumId;
  };
}

export type MusicTrackAlbum = ReturnType<typeof createMusicTrackAlbum>;
