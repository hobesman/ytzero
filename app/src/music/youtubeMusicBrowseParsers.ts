// Pure parsers for YouTube Music album pages, artist pages and mixed search
// results. No network or database access.
import { collect, largestThumbnail, parseSearchItem, type MusicTrack } from "./youtubeMusicParsers";

/** An album (or single) as music mode lists it. */
export interface MusicAlbum {
  browseId: string;
  title: string;
  artist: string;
  artistId: string | null;
  year: string | null;
  thumbnail: string;
  /** "single" for singles and EPs, as far as YouTube says so. */
  kind: "album" | "single";
}

export interface MusicArtist {
  channelId: string;
  name: string;
  thumbnail: string;
}

export interface MusicAlbumPage extends MusicAlbum {
  tracks: MusicTrack[];
}

export interface MusicArtistPage extends MusicArtist {
  topSongs: MusicTrack[];
  albums: MusicAlbum[];
  singles: MusicAlbum[];
}

export const ALBUM_ID = /^MPREb_[A-Za-z0-9_-]{6,40}$/;
export const ARTIST_ID = /^UC[A-Za-z0-9_-]{22}$/;
const YEAR = /^\d{4}$/;
const SINGLE = /\b(single|ep)\b/i;

const runsText = (runs: unknown) => Array.isArray(runs) ? runs.map((run: any) => typeof run?.text === "string" ? run.text : "").join("") : "";

function browseOf(run: any): { id: string; pageType: string | undefined } | null {
  const endpoint = run?.navigationEndpoint?.browseEndpoint ?? run?.browseEndpoint;
  if (typeof endpoint?.browseId !== "string") return null;
  return { id: endpoint.browseId, pageType: endpoint.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType };
}

function thumbnailOf(node: any): string {
  return largestThumbnail(node?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? node?.thumbnails);
}

/** The artists named in a byline, by their artist links; plain text when there is none. */
function bylineArtists(runs: any[], skipFirstSegment: boolean): { artist: string; artistId: string | null } {
  const linked = runs.filter((run) => {
    const type = browseOf(run)?.pageType;
    return type === "MUSIC_PAGE_TYPE_ARTIST" || type === "MUSIC_PAGE_TYPE_USER_CHANNEL";
  });
  if (linked.length) return { artist: linked.map((run) => run.text).join(", "), artistId: browseOf(linked[0])!.id };
  // "Album • Artist • 1969": the artist is the segment after the type label.
  const segments = runsText(runs).split(" • ").map((part) => part.trim()).filter(Boolean);
  const candidates = segments.slice(skipFirstSegment ? 1 : 0).filter((part) => !YEAR.test(part));
  return { artist: candidates[0] ?? "", artistId: null };
}

function yearIn(runs: any[]): string | null {
  return runsText(runs).split(" • ").map((part) => part.trim()).find((part) => YEAR.test(part)) ?? null;
}

/** An album from a search result row: "Album • Artist • 1969". */
function albumFromListItem(item: any): MusicAlbum | null {
  const target = browseOf(item?.navigationEndpoint);
  if (target?.pageType !== "MUSIC_PAGE_TYPE_ALBUM" || !ALBUM_ID.test(target.id)) return null;
  const columns = (item?.flexColumns ?? []).map((column: any) => column?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []);
  const byline: any[] = columns[1] ?? [];
  const label = typeof byline[0]?.text === "string" ? byline[0].text : "";
  return {
    browseId: target.id, title: runsText(columns[0]), ...bylineArtists(byline, true), year: yearIn(byline),
    thumbnail: thumbnailOf(item?.thumbnail), kind: SINGLE.test(label) ? "single" : "album",
  };
}

function artistFromListItem(item: any): MusicArtist | null {
  const target = browseOf(item?.navigationEndpoint);
  if (target?.pageType !== "MUSIC_PAGE_TYPE_ARTIST" || !ARTIST_ID.test(target.id)) return null;
  const columns = (item?.flexColumns ?? []).map((column: any) => column?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []);
  return { channelId: target.id, name: runsText(columns[0]), thumbnail: thumbnailOf(item?.thumbnail) };
}

/** An album card from an artist page's carousel; the artist is the page's own. */
function albumFromTwoRow(item: any, artist: MusicArtist): MusicAlbum | null {
  const target = browseOf(item?.navigationEndpoint);
  if (target?.pageType !== "MUSIC_PAGE_TYPE_ALBUM" || !ALBUM_ID.test(target.id)) return null;
  const subtitle: any[] = item?.subtitle?.runs ?? [];
  return {
    browseId: target.id, title: runsText(item?.title?.runs), artist: artist.name, artistId: artist.channelId,
    year: yearIn(subtitle), thumbnail: thumbnailOf(item?.thumbnailRenderer), kind: SINGLE.test(runsText(subtitle)) ? "single" : "album",
  };
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(key(item)) && Boolean(seen.add(key(item))));
}

/** Albums and artists from an unfiltered search, in YouTube's order, the top result first. */
export function parseSearchShelves(data: unknown): { albums: MusicAlbum[]; artists: MusicArtist[] } {
  const albums: MusicAlbum[] = [];
  const artists: MusicArtist[] = [];
  for (const card of collect(data, "musicCardShelfRenderer")) {
    const target = browseOf(card?.title?.runs?.[0]);
    const subtitle: any[] = card?.subtitle?.runs ?? [];
    if (target?.pageType === "MUSIC_PAGE_TYPE_ALBUM" && ALBUM_ID.test(target.id)) {
      albums.push({ browseId: target.id, title: runsText(card.title.runs), ...bylineArtists(subtitle, true), year: yearIn(subtitle),
        thumbnail: thumbnailOf(card?.thumbnail), kind: SINGLE.test(runsText(subtitle.slice(0, 1))) ? "single" : "album" });
    } else if (target?.pageType === "MUSIC_PAGE_TYPE_ARTIST" && ARTIST_ID.test(target.id)) {
      artists.push({ channelId: target.id, name: runsText(card.title.runs), thumbnail: thumbnailOf(card?.thumbnail) });
    }
  }
  for (const item of collect(data, "musicResponsiveListItemRenderer")) {
    const album = albumFromListItem(item);
    if (album) albums.push(album);
    const artist = artistFromListItem(item);
    if (artist) artists.push(artist);
  }
  return { albums: uniqueBy(albums, (album) => album.browseId), artists: uniqueBy(artists, (artist) => artist.channelId) };
}

/** An album's header and its tracks in album order. Tracks take the album's art and name. */
export function parseAlbumPage(browseId: string, data: unknown): MusicAlbumPage | null {
  const header = collect(data, "musicResponsiveHeaderRenderer")[0] ?? collect(data, "musicDetailHeaderRenderer")[0];
  if (!header) return null;
  const strapline: any[] = header?.straplineTextOne?.runs ?? [];
  const subtitle: any[] = header?.subtitle?.runs ?? [];
  const fromStrapline = bylineArtists(strapline, false);
  const { artist, artistId } = fromStrapline.artist ? fromStrapline : bylineArtists(subtitle, true);
  const title = runsText(header?.title?.runs);
  const thumbnail = thumbnailOf(header?.thumbnail);
  const tracks: MusicTrack[] = [];
  const seen = new Set<string>();
  for (const shelf of collect(data, "musicShelfRenderer")) {
    for (const entry of shelf?.contents ?? []) {
      const track = parseSearchItem(entry?.musicResponsiveListItemRenderer);
      if (!track || seen.has(track.videoId)) continue;
      seen.add(track.videoId);
      tracks.push({
        ...track,
        artist: track.artist || artist,
        artistId: track.artistId ?? artistId,
        album: title,
        thumbnail: track.thumbnail || thumbnail,
      });
    }
  }
  return {
    browseId, title, artist, artistId, year: yearIn(subtitle), thumbnail,
    kind: SINGLE.test(runsText(subtitle.slice(0, 1))) ? "single" : "album", tracks,
  };
}

/** An artist's page: top songs, then their albums and singles carousels. */
export function parseArtistPage(channelId: string, data: unknown): MusicArtistPage | null {
  const header = collect(data, "musicImmersiveHeaderRenderer")[0] ?? collect(data, "musicVisualHeaderRenderer")[0];
  if (!header) return null;
  const artist: MusicArtist = { channelId, name: runsText(header?.title?.runs), thumbnail: thumbnailOf(header?.thumbnail) };
  const topSongs: MusicTrack[] = [];
  for (const shelf of collect(data, "musicShelfRenderer")) {
    for (const entry of shelf?.contents ?? []) {
      const track = parseSearchItem(entry?.musicResponsiveListItemRenderer);
      if (track && !topSongs.some((song) => song.videoId === track.videoId)) topSongs.push({ ...track, artist: track.artist || artist.name });
    }
  }
  // The page's carousels are localized, so they are told apart by content: the
  // first carousel of albums is the albums, the next is singles and EPs.
  const albumCarousels = collect(data, "musicCarouselShelfRenderer")
    .map((carousel) => (carousel?.contents ?? []).map((entry: any) => albumFromTwoRow(entry?.musicTwoRowItemRenderer, artist)).filter(Boolean) as MusicAlbum[])
    .filter((list) => list.length > 0);
  const [albums = [], singles = []] = albumCarousels;
  return { ...artist, topSongs, albums, singles: singles.map((single) => ({ ...single, kind: "single" as const })) };
}
