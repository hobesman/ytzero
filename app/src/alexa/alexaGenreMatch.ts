import type { MusicGenre, MusicGenrePage, MusicPlaylist } from "../music/youtubeMusicClient";
import { letterSimilarity, normalizeSpoken, titleScore, TITLE_MATCH_MIN, wordCoverage } from "./alexaVideoMatch";

/**
 * Turning "80s music", "some jazz" or "the latest pop music" into one of
 * YouTube Music's playlists: a decade goes to that decade's shelf in the
 * Decades category, a genre or mood to its category, and anything else to a
 * search of YouTube Music's own playlists.
 */
export interface GenreSources {
  genres: (userId: number) => Promise<MusicGenre[]>;
  genre: (userId: number, id: string) => Promise<MusicGenrePage | null>;
  searchPlaylists: (userId: number, query: string) => Promise<MusicPlaylist[]>;
}

const FILLER = new Set([
  "a", "an", "the", "some", "something", "music", "songs", "song", "tunes", "playlist", "station", "radio", "mix",
  "for", "to", "of", "me", "please", "kind", "genre", "style", "type", "really", "good", "great",
]);
const NEW_WORDS = new Set(["latest", "new", "newest", "recent", "fresh", "current", "todays", "today"]);
/** Playlist titles that promise new releases, as YouTube Music names them. */
const NEW_TITLE = /\b(new|fresh|latest|hotlist|hot|release|releases|now|today)\b/i;
const CATEGORY_MIN = 0.6;

const DECADE_WORDS: Record<string, number> = {
  twenties: 1920, thirties: 1930, forties: 1940, fifties: 1950, sixties: 1960, seventies: 1970, eighties: 1980, nineties: 1990,
  noughties: 2000, aughts: 2000,
};

export interface SpokenGenre {
  /** What's left once filler, "new" words and the decade are taken out. */
  rest: string;
  decade: number | null;
  wantsNew: boolean;
}

export function parseSpokenGenre(spoken: string): SpokenGenre {
  const words = normalizeSpoken(spoken).split(" ").filter(Boolean);
  let decade: number | null = null;
  let wantsNew = false;
  const rest: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const next = words[index + 1];
    if (NEW_WORDS.has(word)) { wantsNew = true; continue; }
    if (FILLER.has(word)) continue;
    const digits = word.match(/^(\d{2}|\d{4})s$/);
    if (decade === null && digits) {
      const value = Number(digits[1]);
      decade = digits[1].length === 4 ? value : value < 30 ? 2000 + value : 1900 + value;
      continue;
    }
    if (decade === null && DECADE_WORDS[word]) { decade = DECADE_WORDS[word]; continue; }
    // "nineteen eighties", "two thousands", "twenty tens"
    if (decade === null && word === "nineteen" && next && DECADE_WORDS[next]) { decade = DECADE_WORDS[next]; index += 1; continue; }
    if (decade === null && word === "two" && (next === "thousands" || next === "thousand")) { decade = 2000; index += 1; continue; }
    if (decade === null && word === "twenty" && (next === "tens" || next === "teens")) { decade = 2010; index += 1; continue; }
    if (decade === null && word === "twenty" && next === "twenties") { decade = 2020; index += 1; continue; }
    rest.push(word);
  }
  return { rest: rest.join(" "), decade, wantsNew };
}

function categoryScore(spoken: string, title: string): number {
  const similarity = letterSimilarity(spoken, title);
  const covered = wordCoverage(spoken, title);
  return similarity >= CATEGORY_MIN || covered === 1 ? similarity + covered : 0;
}

function bestCategory(spoken: string, genres: readonly MusicGenre[]): MusicGenre | null {
  let best: { genre: MusicGenre; score: number } | null = null;
  for (const genre of genres) {
    const score = categoryScore(spoken, genre.title);
    if (score > 0 && (!best || score > best.score)) best = { genre, score };
  }
  return best?.genre ?? null;
}

/** The playlist among `playlists` whose title best fits `spoken`, else the first. */
function pickPlaylist(playlists: readonly MusicPlaylist[], spoken: string, wantsNew: boolean): MusicPlaylist | null {
  if (wantsNew) {
    const fresh = playlists.find((playlist) => NEW_TITLE.test(playlist.title));
    if (fresh) return fresh;
  }
  if (spoken) {
    let best: { playlist: MusicPlaylist; score: number } | null = null;
    for (const playlist of playlists) {
      const score = titleScore(spoken, playlist.title);
      if (score >= TITLE_MATCH_MIN && (!best || score > best.score)) best = { playlist, score };
    }
    if (best) return best.playlist;
  }
  return playlists[0] ?? null;
}

function remove(words: string, taken: string): string {
  const drop = new Set(normalizeSpoken(taken).split(" "));
  return words.split(" ").filter((word) => word && !drop.has(word)).join(" ");
}

export async function findGenrePlaylist(sources: GenreSources, userId: number, spoken: string): Promise<MusicPlaylist | null> {
  const { rest, decade, wantsNew } = parseSpokenGenre(spoken);
  if (!rest && decade === null) return null;
  const genres = await sources.genres(userId);

  if (decade !== null) {
    // The Decades category's shelves are named "1980s" and so on.
    const label = `${decade}s`;
    for (const genre of genres) {
      if (categoryScore("decades", genre.title) <= 0) continue;
      const page = await sources.genre(userId, genre.id);
      const shelf = page?.shelves.find((candidate) => normalizeSpoken(candidate.title).includes(label));
      const playlist = shelf ? pickPlaylist(shelf.playlists, rest, wantsNew) : null;
      if (playlist) return playlist;
    }
    const [found] = await sources.searchPlaylists(userId, `${label} ${rest || "hits"}`.trim());
    return found ?? null;
  }

  const genre = bestCategory(rest, genres);
  if (genre) {
    const page = await sources.genre(userId, genre.id);
    const playlists = page?.shelves.flatMap((shelf) => shelf.playlists) ?? [];
    // "classic rock" picks Rock, then the playlist that best fits "classic".
    const playlist = pickPlaylist(playlists, remove(rest, genre.title), wantsNew);
    if (playlist) return playlist;
  }
  const [found] = await sources.searchPlaylists(userId, wantsNew ? `new ${rest}` : rest);
  return found ?? null;
}
