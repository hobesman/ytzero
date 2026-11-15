import { upsertMusicTracks, type StoredMusicTrack } from "./musicCatalog";
import type { MusicAlbumPage, MusicArtistPage, MusicGenre, MusicGenrePage, MusicPlaylistPage, YouTubeMusicClient } from "./youtubeMusicClient";

const PAGE_TTL_MS = 30 * 60_000;
const PAGE_CACHE_LIMIT = 200;

export type StoredAlbumPage = Omit<MusicAlbumPage, "tracks"> & { tracks: StoredMusicTrack[] };
export type StoredArtistPage = Omit<MusicArtistPage, "topSongs"> & { topSongs: StoredMusicTrack[] };
export type StoredPlaylistPage = Omit<MusicPlaylistPage, "tracks"> & { tracks: StoredMusicTrack[] };

/**
 * Album, artist, playlist and Moods & genres pages from YouTube Music, kept in memory for a while. Their
 * songs go into the music catalogue so they can be played, liked and recorded.
 */
export function createMusicPages(client: YouTubeMusicClient) {
  const albums = new Map<string, { at: number; page: StoredAlbumPage }>();
  const artists = new Map<string, { at: number; page: StoredArtistPage }>();
  const playlists = new Map<string, { at: number; page: StoredPlaylistPage }>();
  const genreLists = new Map<string, { at: number; page: MusicGenre[] }>();
  const genrePages = new Map<string, { at: number; page: MusicGenrePage }>();

  function remember<T>(cache: Map<string, { at: number; page: T }>, id: string, page: T) {
    cache.delete(id);
    cache.set(id, { at: Date.now(), page });
    while (cache.size > PAGE_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  }

  async function cached<T>(cache: Map<string, { at: number; page: T }>, id: string, load: () => Promise<T | null>): Promise<T | null> {
    const entry = cache.get(id);
    if (entry && Date.now() - entry.at < PAGE_TTL_MS) return entry.page;
    try {
      const page = await load();
      if (page) remember(cache, id, page);
      return page;
    } catch (error) {
      // A stale page beats none while YouTube is unavailable.
      if (entry) return entry.page;
      throw error;
    }
  }

  function album(userId: number, browseId: string): Promise<StoredAlbumPage | null> {
    return cached(albums, browseId, async () => {
      const page = await client.album(userId, browseId);
      return page ? { ...page, tracks: await upsertMusicTracks(page.tracks) } : null;
    });
  }

  function artist(userId: number, channelId: string): Promise<StoredArtistPage | null> {
    return cached(artists, channelId, async () => {
      const page = await client.artist(userId, channelId);
      return page ? { ...page, topSongs: await upsertMusicTracks(page.topSongs) } : null;
    });
  }

  function playlist(userId: number, playlistId: string): Promise<StoredPlaylistPage | null> {
    return cached(playlists, playlistId, async () => {
      const page = await client.playlist(userId, playlistId);
      return page ? { ...page, tracks: await upsertMusicTracks(page.tracks) } : null;
    });
  }

  // Category names come in the profile's language, so these are kept per profile.
  async function genres(userId: number): Promise<MusicGenre[]> {
    return await cached(genreLists, String(userId), async () => {
      const list = await client.genres(userId);
      return list.length ? list : null;
    }) ?? [];
  }

  function genre(userId: number, id: string): Promise<MusicGenrePage | null> {
    return cached(genrePages, `${userId}:${id}`, () => client.genre(userId, id));
  }

  return { album, artist, playlist, genres, genre };
}

export type MusicPages = ReturnType<typeof createMusicPages>;
