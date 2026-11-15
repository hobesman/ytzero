import { describe, expect, test } from "bun:test";
import decadesFixture from "../music/fixtures/ytm-genre-decades.json";
import popFixture from "../music/fixtures/ytm-genre-pop.json";
import moodsFixture from "../music/fixtures/ytm-moods.json";
import { parseGenrePage, parseMoodsAndGenres, type MusicPlaylist } from "../music/youtubeMusicGenreParsers";
import { findGenrePlaylist, parseSpokenGenre, type GenreSources } from "./alexaGenreMatch";

const genres = parseMoodsAndGenres(moodsFixture);
const idOf = (title: string) => genres.find((genre) => genre.title === title)!.id;
const pages = new Map([[idOf("Decades"), parseGenrePage(idOf("Decades"), decadesFixture)], [idOf("Pop"), parseGenrePage(idOf("Pop"), popFixture)]]);

function sources(found: MusicPlaylist[] = []) {
  const searches: string[] = [];
  const opened: string[] = [];
  const value: GenreSources = {
    genres: async () => genres,
    genre: async (_userId, id) => { opened.push(id); return pages.get(id) ?? { id, title: "", shelves: [] }; },
    searchPlaylists: async (_userId, query) => { searches.push(query); return found; },
  };
  return { value, searches, opened };
}

describe("alexa genre phrases", () => {
  test("pick out the decade and whether it should be new", () => {
    expect(parseSpokenGenre("80s music")).toEqual({ rest: "", decade: 1980, wantsNew: false });
    expect(parseSpokenGenre("the eighties")).toMatchObject({ decade: 1980 });
    expect(parseSpokenGenre("nineteen seventies rock")).toEqual({ rest: "rock", decade: 1970, wantsNew: false });
    expect(parseSpokenGenre("'90s hits")).toMatchObject({ decade: 1990, rest: "hits" });
    expect(parseSpokenGenre("2000s")).toMatchObject({ decade: 2000 });
    expect(parseSpokenGenre("the latest pop music")).toEqual({ rest: "pop", decade: null, wantsNew: true });
  });

  test("a decade plays that decade's hits from the Decades category", async () => {
    const { value } = sources();
    expect((await findGenrePlaylist(value, 1, "80s music"))?.title).toBe("The Hits: '80s");
    expect((await findGenrePlaylist(value, 1, "eighties rock ballads"))?.title).toBe("'80s Rock Ballads");
    expect((await findGenrePlaylist(value, 1, "nineties"))?.title).toBe("The Hits: '90s");
  });

  test("a genre plays its category's first playlist, or a new one when asked for the latest", async () => {
    const { value, opened } = sources();
    expect((await findGenrePlaylist(value, 1, "pop music"))?.title).toBe("Non-Stop Lite Pop");
    expect(opened).toEqual([idOf("Pop")]);
    expect((await findGenrePlaylist(value, 1, "the latest pop music"))?.title).toBe("Pop Hotlist");
  });

  test("anything that isn't a category is searched for among YouTube Music's playlists", async () => {
    const found = { playlistId: "RDCLAK5uy_kEKTPKBC1v7lmR6uIdqDp6jg4R67imeXs", title: "Sea Shanties", subtitle: "", thumbnail: "" };
    const { value, searches } = sources([found]);
    expect(await findGenrePlaylist(value, 1, "sea shanties")).toEqual(found);
    expect(searches).toEqual(["sea shanties"]);
    expect(await findGenrePlaylist(value, 1, "music")).toBeNull();
  });
});
