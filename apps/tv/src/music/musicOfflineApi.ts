import type { MusicPlayerTrack } from "../musicPlayerTypes";
import {
  MusicApi, MusicApiError, type MusicAlbum, type MusicAlbumPage, type MusicArtistPage, type MusicLibrary, type MusicPlay, type MusicPlaylistPage,
  type MusicPlaylist, type MusicSearchResults, type MusicSeed, type MusicTrack, type MusicUserPlaylist, type MusicUserPlaylistPage,
} from "./musicApi";
import type { MusicCollectionKind } from "./musicDownloads";
import type { MusicDownloadStore } from "./musicDownloads";

type ArtworkSource = { uri: string; headers?: Record<string, string> };

/** The request never reached the server (no network, timed out), as opposed to an answer it gave. */
export function isUnreachable(error: unknown): boolean {
  return !(error instanceof MusicApiError);
}

function shuffled<T>(values: readonly T[], random = Math.random): T[] {
  const list = [...values];
  for (let index = list.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [list[index], list[other]] = [list[other]!, list[index]!];
  }
  return list;
}

function seedKey(seed: MusicSeed): string {
  if (seed.kind === "track") return `track:${seed.videoId}`;
  if (seed.kind === "playlist") return `playlist:${seed.playlistId}`;
  if (seed.kind === "album") return `album:${seed.browseId}`;
  if (seed.kind === "artist") return `artist:${seed.artistId}`;
  return seed.kind;
}

/**
 * A station made of downloaded songs, for when the server can't be reached.
 * Albums play in order from `startAt`, playlists shuffled (as the server does);
 * a song, the mix and Liked play it or them first and then the rest of the
 * downloads. It ends when they run out.
 */
export function offlineStation(downloads: MusicDownloadStore, seed: MusicSeed, served: readonly string[], skipped: readonly string[],
  count: number, random = Math.random): { seed: string; tracks: MusicTrack[] } {
  const playable = downloads.playable();
  const byId = new Map(playable.map((track) => [track.videoId, track]));
  const collection = (kind: "album" | "playlist", id: string) => (downloads.collection(kind, id)?.trackIds ?? [])
    .map((videoId) => byId.get(videoId)).filter((track): track is MusicTrack => Boolean(track));
  let order: MusicTrack[];
  if (seed.kind === "album") {
    const tracks = collection("album", seed.browseId);
    const from = seed.startAt ? Math.max(0, tracks.findIndex((track) => track.videoId === seed.startAt)) : 0;
    order = tracks.slice(from);
  } else if (seed.kind === "playlist") order = shuffled(collection("playlist", seed.playlistId), random);
  else if (seed.kind === "artist") order = shuffled(playable.filter((track) => track.artistId === seed.artistId), random);
  else {
    const first = seed.kind === "track" ? playable.filter((track) => track.videoId === seed.videoId)
      : seed.kind === "liked" ? shuffled(playable.filter((track) => track.rating === 1), random) : [];
    const firstIds = new Set(first.map((track) => track.videoId));
    order = [...first, ...shuffled(playable.filter((track) => !firstIds.has(track.videoId) && track.rating !== -1), random)];
  }
  const excluded = new Set([...served, ...skipped]);
  return { seed: seedKey(seed), tracks: order.filter((track) => !excluded.has(track.videoId)).slice(0, count) };
}

function userPlaylist(entry: { id: string; title: string; thumbnail: string | null; addedAt: number; syncedAt: number | null }, trackCount: number): MusicUserPlaylist {
  return { id: entry.id, title: entry.title, trackCount, thumbnail: entry.thumbnail ?? "", createdAt: new Date(entry.addedAt).toISOString(), updatedAt: new Date(entry.syncedAt ?? entry.addedAt).toISOString() };
}

const matches = (query: string, ...values: (string | null | undefined)[]) => values.some((value) => value?.toLocaleLowerCase().includes(query));

/**
 * The music API, aware of the music saved on this phone. Downloaded songs play
 * from their file and keep their artwork; when the server can't be reached the
 * screens get the downloaded library instead of an error, and listens wait on
 * the phone until the server can take them.
 */
export class OfflineMusicApi extends MusicApi {
  private readonly localSources = new Map<string, ArtworkSource>();

  constructor(instanceUrl: string, accessToken: string | undefined, readonly downloads: MusicDownloadStore) {
    super(instanceUrl, accessToken);
  }

  /** Runs a request, noting whether it reached the server, and falls back to the downloads when it didn't. */
  private async reach<T>(request: () => Promise<T>, fallback: () => T | null): Promise<T> {
    try {
      const result = await request();
      this.downloads.setReachable(true);
      return result;
    } catch (error) {
      if (!isUnreachable(error)) { this.downloads.setReachable(true); throw error; }
      this.downloads.setReachable(false);
      const offline = fallback();
      if (offline === null) throw error;
      return offline;
    }
  }

  private downloadedPlaylists(kind: "playlist" | "mine") { return this.downloads.collections().filter((entry) => entry.kind === kind); }

  private downloadedAlbums(): MusicAlbum[] {
    return this.downloads.collections().filter((entry) => entry.kind === "album").map((entry) => entry.album ?? {
      browseId: entry.id, title: entry.title, artist: entry.subtitle, artistId: null, year: null, thumbnail: entry.thumbnail, kind: "album" as const,
    });
  }

  private collectionTracks(kind: MusicCollectionKind, id: string): MusicTrack[] | null {
    const entry = this.downloads.collection(kind, id);
    if (!entry) return null;
    const playable = new Map(this.downloads.playable().map((track) => [track.videoId, track]));
    return entry.trackIds.map((videoId) => playable.get(videoId)).filter((track): track is MusicTrack => Boolean(track));
  }

  override async album(browseId: string): Promise<MusicAlbumPage> {
    let offline = false;
    const page = await this.reach(() => super.album(browseId), () => {
      const tracks = this.collectionTracks("album", browseId);
      const album = this.downloadedAlbums().find((entry) => entry.browseId === browseId);
      offline = true;
      return tracks && album ? { ...album, tracks, saved: false } : null;
    });
    if (!offline) void this.downloads.refresh("album", page);
    return page;
  }

  override async playlist(playlistId: string): Promise<MusicPlaylistPage> {
    let offline = false;
    const page = await this.reach(() => super.playlist(playlistId), () => {
      const entry = this.downloads.collection("playlist", playlistId);
      const tracks = this.collectionTracks("playlist", playlistId);
      offline = true;
      return entry && tracks ? { playlistId, title: entry.title, subtitle: entry.subtitle, thumbnail: entry.thumbnail, tracks, saved: false } : null;
    });
    if (!offline) void this.downloads.refresh("playlist", page);
    return page;
  }

  override async myPlaylist(id: string): Promise<MusicUserPlaylistPage> {
    let offline = false;
    const page = await this.reach(() => super.myPlaylist(id), () => {
      const entry = this.downloads.collection("mine", id);
      const tracks = this.collectionTracks("mine", id);
      offline = true;
      return entry && tracks ? { ...userPlaylist(entry, tracks.length), tracks } : null;
    });
    if (!offline) void this.downloads.refresh("mine", page);
    return page;
  }

  override async myPlaylists(): Promise<MusicUserPlaylist[]> {
    return this.reach(() => super.myPlaylists(), () => this.offlinePlaylists().playlists);
  }

  private offlinePlaylists(): { playlists: MusicUserPlaylist[]; savedPlaylists: MusicPlaylist[] } {
    return {
      playlists: this.downloadedPlaylists("mine").map((entry) => userPlaylist(entry, this.collectionTracks("mine", entry.id)?.length ?? 0)),
      savedPlaylists: this.downloadedPlaylists("playlist").map((entry) => ({ playlistId: entry.id, title: entry.title, subtitle: entry.subtitle, thumbnail: entry.thumbnail })),
    };
  }

  // A downloaded playlist of the profile's own follows its edits at once.
  override async addToPlaylist(id: string, videoId: string) { return this.edited(id, await super.addToPlaylist(id, videoId)); }
  override async removeFromPlaylist(id: string, videoId: string) { return this.edited(id, await super.removeFromPlaylist(id, videoId)); }
  override async reorderPlaylist(id: string, videoIds: string[]) { return this.edited(id, await super.reorderPlaylist(id, videoIds)); }
  override async renamePlaylist(id: string, title: string) { return this.edited(id, await super.renamePlaylist(id, title)); }
  private edited<T>(id: string, result: T): T { void this.downloads.syncCollection("mine", id); return result; }

  override async artist(channelId: string): Promise<MusicArtistPage> {
    return this.reach(() => super.artist(channelId), () => {
      const topSongs = this.downloads.playable().filter((track) => track.artistId === channelId);
      const albums = this.downloadedAlbums().filter((album) => album.artistId === channelId);
      if (!topSongs.length && !albums.length) return null;
      const name = topSongs[0]?.artist ?? albums[0]?.artist ?? "";
      return { channelId, name, thumbnail: null, topSongs, albums: albums.filter((album) => album.kind === "album"), singles: albums.filter((album) => album.kind === "single") };
    });
  }

  override async library(): Promise<MusicLibrary> {
    return this.reach(() => super.library(), () => ({
      liked: this.downloads.playable().filter((track) => track.rating === 1), recent: [], albums: this.downloadedAlbums(), ...this.offlinePlaylists(),
    }));
  }

  override async search(q: string): Promise<MusicSearchResults> {
    const query = q.trim().toLocaleLowerCase();
    return this.reach(() => super.search(q), () => ({
      tracks: this.downloads.playable().filter((track) => matches(query, track.title, track.artist, track.album)),
      albums: this.downloadedAlbums().filter((album) => matches(query, album.title, album.artist)),
      artists: [],
    }));
  }

  override async station(seed: MusicSeed, served: string[], skipped: string[], count = 10): Promise<{ seed: string; tracks: MusicTrack[] }> {
    return this.reach(() => super.station(seed, served, skipped, count), () => {
      const station = offlineStation(this.downloads, seed, served, skipped, count);
      // With nothing downloaded to play, the screens show why the station didn't start.
      return !station.tracks.length && !served.length ? null : station;
    });
  }

  /** A downloaded song needs no preparing. */
  override async prepare(videoId: string): Promise<boolean> {
    return this.downloads.localAudio(videoId) ? true : super.prepare(videoId);
  }

  /** A listen the server can't be told about now is sent later. Incognito listens never get here. */
  override async recordPlay(play: MusicPlay): Promise<{ ok: true }> {
    return this.reach(() => super.recordPlay(play), () => {
      this.downloads.queuePlay(play);
      return { ok: true as const };
    });
  }

  override artworkSource(url: string | null | undefined): ArtworkSource | null {
    const local = this.downloads.localArtwork(url);
    if (!local) return super.artworkSource(url);
    // The same object for the same file, so lists don't reload the image.
    let source = this.localSources.get(local);
    if (!source) { source = { uri: local }; this.localSources.set(local, source); }
    return source;
  }

  override playerTrack(track: MusicTrack): MusicPlayerTrack {
    const base = super.playerTrack(track);
    const audio = this.downloads.localAudio(track.videoId);
    if (!audio) return base;
    return { ...base, url: audio, artwork: this.downloads.localArtwork(track.thumbnail) ?? base.artwork };
  }
}
