import { describe, expect, test } from "bun:test";
import decadesFixture from "./fixtures/ytm-genre-decades.json";
import popFixture from "./fixtures/ytm-genre-pop.json";
import moodsFixture from "./fixtures/ytm-moods.json";
import playlistSearchFixture from "./fixtures/ytm-playlist-search.json";
import playlistFixture from "./fixtures/ytm-playlist.json";
import { parseStationSeed, stationSeedKey } from "./musicStation";
import { parseGenrePage, parseMoodsAndGenres, parsePlaylistPage, parsePlaylistSearch, playlistIdOf } from "./youtubeMusicGenreParsers";

// The fixtures are trimmed copies of real YouTube Music responses (WEB_REMIX, signed out, English).
const HITS_80S = "RDCLAK5uy_lMzHW51iFg1Kx0d_2EHpzbOgCrwtu8cgI";

describe("YouTube Music Moods & genres parsers", () => {
  test("lists moods, then genres, with their colours", () => {
    const genres = parseMoodsAndGenres(moodsFixture);
    expect(genres).toHaveLength(40);
    expect(genres[0]).toEqual({ id: "ggMPOg1uX1JOQWZFeDByc2Jm", title: "Chill", group: "mood", color: "#a4c5ff" });
    expect(genres.filter((genre) => genre.group === "mood").map((genre) => genre.title)).toContain("Workout");
    expect(genres.find((genre) => genre.title === "Decades")).toMatchObject({ group: "genre" });
    expect(new Set(genres.map((genre) => genre.id)).size).toBe(40);
  });

  test("reads a category's playlist shelves and leaves out songs, videos and albums", () => {
    const decades = parseGenrePage("decades", decadesFixture)!;
    expect(decades.title).toBe("Decades");
    expect(decades.shelves.map((shelf) => shelf.title)).toEqual(["2010s", "2000s", "1990s", "1980s", "1970s", "1960s", "1950s"]);
    expect(decades.shelves[3].playlists[0]).toMatchObject({ playlistId: HITS_80S, title: "The Hits: '80s", subtitle: "Playlist • YouTube Music" });

    const pop = parseGenrePage("pop", popFixture)!;
    expect(pop.shelves.map((shelf) => shelf.title)).toEqual(["Featured playlists", "Community playlists"]);
    expect(pop.shelves[1].playlists[0].playlistId).toBe("PLZE6A-lSska7ocd3IOG56EFwRVZdjyQKV");
  });

  test("reads a playlist's header and songs", () => {
    const page = parsePlaylistPage(HITS_80S, playlistFixture)!;
    expect(page).toMatchObject({ playlistId: HITS_80S, title: "The Hits: '80s" });
    expect(page.thumbnail).toStartWith("https://");
    expect(page.tracks).toHaveLength(5);
    expect(page.tracks[0]).toMatchObject({ videoId: "0JFbiCg-8n4", artist: "Michael Jackson", duration: 279 });
    expect(parsePlaylistPage(HITS_80S, {})).toBeNull();
  });

  test("finds YouTube Music's playlists in a playlist search", () => {
    const playlists = parsePlaylistSearch(playlistSearchFixture);
    expect(playlists.length).toBe(4);
    expect(playlists[0]).toMatchObject({ playlistId: "RDCLAK5uy_kEKTPKBC1v7lmR6uIdqDp6jg4R67imeXs", title: "Japan Hits: '80s" });
  });

  test("accepts only playlist IDs it knows the shape of", () => {
    expect(playlistIdOf(`VL${HITS_80S}`)).toBe(HITS_80S);
    expect(playlistIdOf("PLZE6A-lSska7ocd3IOG56EFwRVZdjyQKV")).toBe("PLZE6A-lSska7ocd3IOG56EFwRVZdjyQKV");
    expect(playlistIdOf("MPREb_6jFmDmGUjMz")).toBeNull();
    expect(playlistIdOf("../../etc")).toBeNull();
  });

  test("a playlist station has a seed of its own", () => {
    expect(parseStationSeed({ kind: "playlist", playlistId: HITS_80S })).toEqual({ kind: "playlist", playlistId: HITS_80S });
    expect(parseStationSeed({ kind: "playlist", playlistId: "nope" })).toBeNull();
    expect(stationSeedKey({ kind: "playlist", playlistId: HITS_80S })).toBe(`playlist:${HITS_80S}`);
  });
});
