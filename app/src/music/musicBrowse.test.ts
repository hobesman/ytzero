import { describe, expect, test } from "bun:test";
import albumFixture from "./fixtures/ytm-album.json";
import artistFixture from "./fixtures/ytm-artist.json";
import searchFixture from "./fixtures/ytm-search.json";
import { parseStationSeed, stationSeedKey } from "./musicStation";
import { parseAlbumPage, parseArtistPage, parseSearchShelves } from "./youtubeMusicBrowseParsers";

// The fixtures are trimmed copies of real YouTube Music responses (WEB_REMIX, signed out).
const BEATLES = "UC2XdaAVUannpujzv32jcouQ";

describe("YouTube Music browse parsers", () => {
  test("finds albums and artists in an unfiltered search, the top result first", () => {
    const { albums, artists } = parseSearchShelves(searchFixture);
    expect(albums.map((album) => album.browseId)).toEqual(["MPREb_LQwx7Jq6u9H", "MPREb_tQfaWH32ovE", "MPREb_GOFIhgRPUsi", "MPREb_S5TiUIYvI78"]);
    expect(albums[0]).toMatchObject({ title: "Abbey Road (2019 Mix)", artist: "The Beatles", artistId: BEATLES, year: "1969", kind: "album" });
    expect(albums[0].thumbnail).toStartWith("https://");
    expect(artists.map((artist) => artist.name)).toEqual(["The Beatles", "George Harrison", "John Lennon"]);
  });

  test("reads an album's header and its tracks in order, with the album's art and name", () => {
    const page = parseAlbumPage("MPREb_LQwx7Jq6u9H", albumFixture)!;
    expect(page).toMatchObject({ title: "Abbey Road (2019 Mix)", artist: "The Beatles", artistId: BEATLES, year: "1969", kind: "album" });
    expect(page.tracks).toHaveLength(17);
    expect(page.tracks[0]).toMatchObject({ videoId: "45cYwDMibGo", title: "Come Together (2019 Mix)", artist: "The Beatles", album: page.title, duration: 261, thumbnail: page.thumbnail });
    expect(new Set(page.tracks.map((track) => track.videoId)).size).toBe(17);
  });

  test("reads an artist's top songs, albums and singles", () => {
    const page = parseArtistPage(BEATLES, artistFixture)!;
    expect(page.name).toBe("The Beatles");
    expect(page.topSongs.map((song) => song.videoId)).toEqual(["QDYfEBY9NM4", "2Vv5pkwpFzk", "_VM8gB6Ywfc", "5tc0gLSSU1M", "YBcdt6DsLQA"]);
    expect(page.albums.length).toBe(10);
    expect(page.albums.every((album) => album.kind === "album" && album.artistId === BEATLES)).toBe(true);
    expect(page.albums.map((album) => album.browseId)).toContain("MPREb_LQwx7Jq6u9H");
    expect(page.singles.length).toBe(9);
    expect(page.singles.every((single) => single.kind === "single")).toBe(true);
  });

  test("returns nothing for a page without a header", () => {
    expect(parseAlbumPage("MPREb_LQwx7Jq6u9H", {})).toBeNull();
    expect(parseArtistPage(BEATLES, {})).toBeNull();
    expect(parseSearchShelves({})).toEqual({ albums: [], artists: [] });
  });
});

describe("album and artist station seeds", () => {
  test("validate their ids and key the station", () => {
    expect(parseStationSeed({ kind: "album", browseId: "MPREb_LQwx7Jq6u9H" })).toEqual({ kind: "album", browseId: "MPREb_LQwx7Jq6u9H" });
    expect(parseStationSeed({ kind: "album", browseId: "MPREb_LQwx7Jq6u9H", startAt: "45cYwDMibGo" }))
      .toEqual({ kind: "album", browseId: "MPREb_LQwx7Jq6u9H", startAt: "45cYwDMibGo" });
    expect(parseStationSeed({ kind: "album", browseId: "MPREb_LQwx7Jq6u9H", startAt: "bad" })).toBeNull();
    expect(parseStationSeed({ kind: "album", browseId: "VLPL123" })).toBeNull();
    expect(parseStationSeed({ kind: "artist", artistId: BEATLES })).toEqual({ kind: "artist", artistId: BEATLES });
    expect(parseStationSeed({ kind: "artist", artistId: "UCshort" })).toBeNull();
    expect(stationSeedKey({ kind: "album", browseId: "MPREb_LQwx7Jq6u9H" })).toBe("album:MPREb_LQwx7Jq6u9H");
    expect(stationSeedKey({ kind: "artist", artistId: BEATLES })).toBe(`artist:${BEATLES}`);
  });
});
