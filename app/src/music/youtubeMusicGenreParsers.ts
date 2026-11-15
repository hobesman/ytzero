// Pure parsers for YouTube Music's Moods & genres pages and playlist pages.
// No network or database access.
import { collect, largestThumbnail, parseSearchItem, type MusicTrack } from "./youtubeMusicParsers";

/** A Moods & genres category, such as Pop, Decades or Chill. */
export interface MusicGenre {
  /** The category's browse params, which identify it to YouTube Music. */
  id: string;
  title: string;
  /** "mood" for Moods & moments, "genre" for Genres, as YouTube groups them. */
  group: "mood" | "genre";
  /** The colour YouTube Music shows the category's button in, as `#rrggbb`. */
  color: string | null;
}

export interface MusicPlaylist {
  playlistId: string;
  title: string;
  /** What YouTube shows under the title: its author, or a few of its artists. */
  subtitle: string;
  thumbnail: string;
}

export interface MusicGenreShelf {
  title: string;
  playlists: MusicPlaylist[];
}

export interface MusicGenrePage {
  id: string;
  title: string;
  /** The category's playlist carousels, in YouTube's order; shelves of songs, videos or albums are left out. */
  shelves: MusicGenreShelf[];
}

export interface MusicPlaylistPage extends MusicPlaylist {
  tracks: MusicTrack[];
}

export const GENRE_ID = /^[A-Za-z0-9_-]{8,80}={0,2}$/;
/** YouTube Music's own playlists (RDCLAK5uy_…), albums as playlists (OLAK5uy_…) and user playlists (PL…). */
export const PLAYLIST_ID = /^(?:RDCLAK5uy_|OLAK5uy_|PL)[A-Za-z0-9_-]{10,60}$/;
const GENRE_BROWSE_ID = "FEmusic_moods_and_genres_category";

const runsText = (runs: unknown) => Array.isArray(runs) ? runs.map((run: any) => typeof run?.text === "string" ? run.text : "").join("") : "";

/** A playlist ID from a browse ID ("VL" + the ID) or a bare one. */
export function playlistIdOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.startsWith("VL") ? value.slice(2) : value;
  return PLAYLIST_ID.test(id) ? id : null;
}

function colorOf(value: unknown): string | null {
  const argb = Number(value);
  if (!Number.isFinite(argb) || argb <= 0) return null;
  return `#${(argb & 0xffffff).toString(16).padStart(6, "0")}`;
}

/**
 * The categories on YouTube Music's Moods & genres page. The page has two grids,
 * moods first and genres second; their headers are localized, so the order
 * tells them apart.
 */
export function parseMoodsAndGenres(data: unknown): MusicGenre[] {
  const genres: MusicGenre[] = [];
  const seen = new Set<string>();
  collect(data, "gridRenderer").forEach((grid, index) => {
    for (const item of grid?.items ?? []) {
      const button = item?.musicNavigationButtonRenderer;
      const endpoint = button?.clickCommand?.browseEndpoint;
      const id = endpoint?.params;
      const title = runsText(button?.buttonText?.runs).trim();
      if (endpoint?.browseId !== GENRE_BROWSE_ID || typeof id !== "string" || !GENRE_ID.test(id) || !title || seen.has(id)) continue;
      seen.add(id);
      genres.push({ id, title, group: index === 0 ? "mood" : "genre", color: colorOf(button?.solid?.leftStripeColor) });
    }
  });
  return genres;
}

function playlistFromTwoRow(item: any): MusicPlaylist | null {
  const playlistId = playlistIdOf(item?.navigationEndpoint?.browseEndpoint?.browseId);
  if (!playlistId) return null;
  return {
    playlistId,
    title: runsText(item?.title?.runs).trim(),
    subtitle: runsText(item?.subtitle?.runs).trim(),
    thumbnail: largestThumbnail(item?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails),
  };
}

/** A category's page: its playlist carousels, each with its title. */
export function parseGenrePage(id: string, data: unknown): MusicGenrePage | null {
  const header = collect(data, "musicHeaderRenderer")[0];
  const shelves: MusicGenreShelf[] = [];
  for (const carousel of [...collect(data, "musicCarouselShelfRenderer"), ...collect(data, "gridRenderer")]) {
    const title = runsText(carousel?.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs ?? carousel?.header?.gridHeaderRenderer?.title?.runs).trim();
    const playlists = (carousel?.contents ?? carousel?.items ?? [])
      .map((entry: any) => playlistFromTwoRow(entry?.musicTwoRowItemRenderer))
      .filter((playlist: MusicPlaylist | null): playlist is MusicPlaylist => Boolean(playlist));
    if (playlists.length) shelves.push({ title, playlists });
  }
  if (!header && !shelves.length) return null;
  return { id, title: runsText(header?.title?.runs).trim(), shelves };
}

/** A playlist's header and its songs, in playlist order. */
export function parsePlaylistPage(playlistId: string, data: unknown): MusicPlaylistPage | null {
  const header = collect(data, "musicResponsiveHeaderRenderer")[0] ?? collect(data, "musicDetailHeaderRenderer")[0];
  if (!header) return null;
  const tracks: MusicTrack[] = [];
  const seen = new Set<string>();
  for (const shelf of [...collect(data, "musicPlaylistShelfRenderer"), ...collect(data, "musicShelfRenderer")]) {
    for (const entry of shelf?.contents ?? []) {
      const track = parseSearchItem(entry?.musicResponsiveListItemRenderer);
      if (!track || seen.has(track.videoId)) continue;
      seen.add(track.videoId);
      tracks.push(track);
    }
  }
  return {
    playlistId,
    title: runsText(header?.title?.runs).trim(),
    subtitle: runsText(header?.straplineTextOne?.runs ?? header?.subtitle?.runs).trim(),
    thumbnail: largestThumbnail(header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? header?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails),
    tracks,
  };
}

/** Playlists from a playlist-filtered search, the top result first. */
export function parsePlaylistSearch(data: unknown): MusicPlaylist[] {
  const playlists: MusicPlaylist[] = [];
  for (const item of collect(data, "musicResponsiveListItemRenderer")) {
    const playlistId = playlistIdOf(item?.navigationEndpoint?.browseEndpoint?.browseId);
    if (!playlistId || playlists.some((playlist) => playlist.playlistId === playlistId)) continue;
    const columns = (item?.flexColumns ?? []).map((column: any) => runsText(column?.musicResponsiveListItemFlexColumnRenderer?.text?.runs).trim());
    playlists.push({
      playlistId,
      title: columns[0] ?? "",
      subtitle: columns[1] ?? "",
      thumbnail: largestThumbnail(item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
    });
  }
  return playlists;
}
