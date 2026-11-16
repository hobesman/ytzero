import { http } from "../apiHttp";

/** A song as the server's music routes return it. */
export type MusicTrack = {
  videoId: string;
  title: string;
  artist: string;
  artistId: string | null;
  album: string | null;
  duration: number | null;
  thumbnail: string | null;
  isTopic: boolean;
  rating: 1 | -1 | null;
};

export type MusicAlbum = {
  browseId: string; title: string; artist: string; artistId: string | null; year: string | null; thumbnail: string | null; kind: "album" | "single";
};
export type MusicArtist = { channelId: string; name: string; thumbnail: string | null };
export type MusicAlbumPage = MusicAlbum & { tracks: MusicTrack[]; saved: boolean };
export type MusicArtistPage = MusicArtist & { topSongs: MusicTrack[]; albums: MusicAlbum[]; singles: MusicAlbum[] };
/** A Moods & genres category; its name comes from YouTube Music, already translated. */
export type MusicGenre = { id: string; title: string; group: "mood" | "genre"; color: string | null };
export type MusicPlaylist = { playlistId: string; title: string; subtitle: string; thumbnail: string | null };
export type MusicGenrePage = { id: string; title: string; shelves: { title: string; playlists: MusicPlaylist[] }[] };
export type MusicPlaylistPage = MusicPlaylist & { tracks: MusicTrack[]; saved: boolean };
/** A playlist the profile made itself. */
export type MusicUserPlaylist = { id: string; title: string; trackCount: number; thumbnail: string; createdAt: string; updatedAt: string };
export type MusicUserPlaylistPage = MusicUserPlaylist & { tracks: MusicTrack[] };
export type MusicSearchResults = { tracks: MusicTrack[]; albums: MusicAlbum[]; artists: MusicArtist[] };
export type MusicLibrary = {
  liked: MusicTrack[]; recent: MusicTrack[]; albums: MusicAlbum[]; playlists: MusicUserPlaylist[]; savedPlaylists: MusicPlaylist[];
};

export type MusicSeed =
  | { kind: "track"; videoId: string }
  | { kind: "liked" }
  | { kind: "mix" }
  | { kind: "album"; browseId: string; startAt?: string }
  | { kind: "artist"; artistId: string }
  | { kind: "playlist"; playlistId: string };

export type MusicEndReason = "completed" | "skipped" | "stopped";
export type MusicPlay = {
  videoId: string; startedAt: string; listenedSeconds: number; duration: number | null; endReason: MusicEndReason; stationSeed: string | null;
};

/** A song's lyrics: time-synced lines when known, else plain text. `source` is who to credit. */
export type MusicLyrics = {
  videoId: string; synced: { time: number; text: string }[] | null; plain: string | null; instrumental: boolean; source: string | null;
};

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const id = encodeURIComponent;

/**
 * Music mode's whole conversation with the server. It uses only `/api/music/*`,
 * so listening never touches video history, progress or subscriptions.
 */
export const musicApi = {
  search: (q: string) => http<MusicSearchResults>(`/music/search?q=${id(q.trim())}`),
  library: () => http<MusicLibrary>("/music/library"),
  album: (browseId: string) => http<MusicAlbumPage>(`/music/albums/${id(browseId)}`),
  artist: (channelId: string) => http<MusicArtistPage>(`/music/artists/${id(channelId)}`),
  genres: async () => (await http<{ genres: MusicGenre[] }>("/music/genres")).genres,
  genre: (genreId: string) => http<MusicGenrePage>(`/music/genres/${id(genreId)}`),
  playlist: (playlistId: string) => http<MusicPlaylistPage>(`/music/playlists/${id(playlistId)}`),
  setAlbumSaved: (browseId: string, saved: boolean) =>
    http<{ ok: true; saved: boolean }>(`/music/albums/${id(browseId)}/saved`, { method: saved ? "PUT" : "DELETE" }),
  setPlaylistSaved: (playlistId: string, saved: boolean) =>
    http<{ ok: true; saved: boolean }>(`/music/playlists/${id(playlistId)}/saved`, { method: saved ? "PUT" : "DELETE" }),
  myPlaylists: async () => (await http<{ playlists: MusicUserPlaylist[] }>("/music/my-playlists")).playlists,
  myPlaylist: (playlistId: string) => http<MusicUserPlaylistPage>(`/music/my-playlists/${id(playlistId)}`),
  createPlaylist: async (title: string) => (await http<{ playlist: MusicUserPlaylist }>("/music/my-playlists", json({ title }))).playlist,
  renamePlaylist: (playlistId: string, title: string) =>
    http<{ ok: true; title: string }>(`/music/my-playlists/${id(playlistId)}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deletePlaylist: (playlistId: string) => http<{ ok: true }>(`/music/my-playlists/${id(playlistId)}`, { method: "DELETE" }),
  /** `added` is false when the song was already in the playlist. */
  addToPlaylist: (playlistId: string, videoId: string) => http<{ ok: true; added: boolean }>(`/music/my-playlists/${id(playlistId)}/tracks`, json({ videoId })),
  removeFromPlaylist: (playlistId: string, videoId: string) =>
    http<{ ok: true }>(`/music/my-playlists/${id(playlistId)}/tracks/${id(videoId)}`, { method: "DELETE" }),
  reorderPlaylist: (playlistId: string, videoIds: string[]) =>
    http<{ ok: true }>(`/music/my-playlists/${id(playlistId)}/order`, { method: "PUT", body: JSON.stringify({ videoIds }) }),
  station: (seed: MusicSeed, served: string[], skipped: string[], count = 10) =>
    http<{ seed: string; tracks: MusicTrack[] }>("/music/station", json({ seed, served, skipped, count })),
  recordPlay: (play: MusicPlay) => http<{ ok: true }>("/music/plays", json(play)),
  rate: (videoId: string, rating: 1 | 0 | -1) => http<{ ok: true }>(`/music/tracks/${id(videoId)}/rating`, { method: "PUT", body: JSON.stringify({ rating }) }),
  lyrics: (videoId: string) => http<MusicLyrics>(`/music/tracks/${id(videoId)}/lyrics`),
  audioUrl: (videoId: string) => `/api/music/tracks/${id(videoId)}/audio`,
};
