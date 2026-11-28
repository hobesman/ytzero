import { describe, expect, test } from "bun:test";
import { chooseAudioStream, createPlexClient, parsePlexItem, plexConfig, type PlexAudioStream } from "./plexClient";

/** A movie as /library/metadata/:id?includeChapters=1 answers it, trimmed to the fields used. */
const MOVIE = {
  ratingKey: "101", type: "movie", title: "Heat", year: 1995, duration: 10_200_000, viewOffset: 3_600_000, viewCount: 0,
  thumb: "/library/metadata/101/thumb/1700000000", contentRating: "R", lastViewedAt: 1_700_000_000,
  Media: [{ duration: 10_200_000, Part: [{ id: 9, key: "/library/parts/9/1700000000/file.mkv", Stream: [
    { streamType: 1, index: 0, codec: "h264" },
    { streamType: 2, index: 1, codec: "eac3", channels: 6, languageCode: "eng", title: "Commentary with Michael Mann" },
    { streamType: 2, index: 2, codec: "dca", channels: 6, languageCode: "eng", default: true, selected: true, displayTitle: "English (DTS 5.1)" },
    { streamType: 3, index: 3, codec: "srt" },
  ] }] }],
  Chapter: [
    { tag: "Opening", startTimeOffset: 0, endTimeOffset: 600_000 },
    { tag: "The Heist", startTimeOffset: 600_000, endTimeOffset: 1_800_000 },
  ],
};

const EPISODE = {
  ratingKey: "202", type: "episode", title: "The Fire", parentIndex: 2, index: 4, grandparentTitle: "The Office", grandparentRatingKey: "200",
  grandparentThumb: "/library/metadata/200/thumb/1", duration: 1_320_000, viewCount: 1,
  Media: [{ Part: [{ key: "/library/parts/22/1/file.mp4", Stream: [{ streamType: 2, index: 1, codec: "aac", channels: 2, languageCode: "eng" }] }] }],
};

describe("config", () => {
  test("needs both the address and the token", () => {
    expect(plexConfig({})).toEqual({ disabled: "YTZERO_PLEX_URL and YTZERO_PLEX_TOKEN are not set" });
    expect(plexConfig({ YTZERO_PLEX_URL: "http://127.0.0.1:32400" })).toEqual({ disabled: "YTZERO_PLEX_TOKEN is not set" });
    expect(plexConfig({ YTZERO_PLEX_URL: "ftp://x", YTZERO_PLEX_TOKEN: "t" })).toEqual({ disabled: "YTZERO_PLEX_URL must start with http:// or https://" });
    expect(plexConfig({ YTZERO_PLEX_URL: "\"http://127.0.0.1:32400/\"", YTZERO_PLEX_TOKEN: "abc" })).toEqual({ url: "http://127.0.0.1:32400", token: "abc" });
  });
});

describe("parsing", () => {
  test("a movie with its audio tracks, chapters and saved place", () => {
    const movie = parsePlexItem(MOVIE)!;
    expect(movie).toMatchObject({ id: "101", type: "movie", title: "Heat", year: 1995, duration: 10_200, viewOffset: 3_600, watched: false, partKey: "/library/parts/9/1700000000/file.mkv", show: null });
    expect(movie.audio.map((stream) => stream.index)).toEqual([1, 2]);
    expect(movie.chapters).toEqual([{ start: 0, end: 600, title: "Opening" }, { start: 600, end: 1_800, title: "The Heist" }]);
  });

  test("an episode with its show and numbers, and the show's poster", () => {
    expect(parsePlexItem(EPISODE)).toMatchObject({ id: "202", type: "episode", show: { id: "200", title: "The Office" }, season: 2, episode: 4, watched: true, thumb: "/library/metadata/200/thumb/1" });
  });

  test("nothing without a file, or for a show or a track", () => {
    expect(parsePlexItem({ ...MOVIE, Media: [] })).toBeNull();
    expect(parsePlexItem({ ...MOVIE, type: "show" })).toBeNull();
    expect(parsePlexItem({ ...MOVIE, ratingKey: "../x" })).toBeNull();
  });
});

describe("choosing the audio track", () => {
  const stream = (fields: Partial<PlexAudioStream>): PlexAudioStream => ({ index: 1, codec: "ac3", channels: 6, language: "eng", title: "", selected: false, default: false, ...fields });

  test("Plex's selection first, then the default, then English that isn't a commentary", () => {
    expect(chooseAudioStream(parsePlexItem(MOVIE)!.audio)?.index).toBe(2);
    expect(chooseAudioStream([stream({ index: 1, language: "fra" }), stream({ index: 2, default: true })])?.index).toBe(2);
    expect(chooseAudioStream([stream({ index: 1, title: "Director's commentary" }), stream({ index: 2, language: "jpn" }), stream({ index: 3 })])?.index).toBe(3);
    expect(chooseAudioStream([stream({ index: 1, language: "jpn" }), stream({ index: 2, language: "fra" })])?.index).toBe(1);
    expect(chooseAudioStream([])).toBeNull();
  });
});

describe("client", () => {
  test("sends the token as a header and reads search hubs", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const client = createPlexClient({ url: "http://plex:32400", token: "secret" }, async (url, init) => {
      calls.push({ url, headers: init?.headers as Record<string, string> });
      return Response.json({ MediaContainer: { Hub: [
        { type: "movie", Metadata: [{ ratingKey: "101", type: "movie", title: "Heat", year: 1995 }] },
        { type: "show", Metadata: [{ ratingKey: "200", type: "show", title: "The Office" }] },
        { type: "artist", Metadata: [{ ratingKey: "300", type: "artist", title: "Heatmiser" }] },
      ] } });
    });
    expect(await client.search("heat")).toMatchObject([
      { id: "101", type: "movie", title: "Heat", year: 1995, showTitle: null },
      { id: "200", type: "show", title: "The Office", year: null, showTitle: null },
    ]);
    expect(calls[0]!.url).toBe("http://plex:32400/hubs/search?query=heat&limit=10&includeCollections=0");
    expect(calls[0]!.headers["X-Plex-Token"]).toBe("secret");
    expect(calls[0]!.url).not.toContain("secret");
  });

  test("an unknown item is null, a refused token an error", async () => {
    const missing = createPlexClient({ url: "http://plex", token: "t" }, async () => new Response("", { status: 404 }));
    expect(await missing.item("5")).toBeNull();
    const refused = createPlexClient({ url: "http://plex", token: "t" }, async () => new Response("", { status: 401 }));
    await expect(refused.item("5")).rejects.toThrow("Plex refused the token");
  });

  test("saves progress in milliseconds and marks watched", async () => {
    const urls: string[] = [];
    const client = createPlexClient({ url: "http://plex", token: "t" }, async (url) => { urls.push(url); return new Response(""); });
    await client.saveProgress("101", 61.5, "playing");
    await client.markWatched("101");
    expect(urls).toEqual([
      "http://plex/:/progress?key=101&identifier=com.plexapp.plugins.library&time=61500&state=playing",
      "http://plex/:/scrobble?key=101&identifier=com.plexapp.plugins.library",
    ]);
  });

  test("hands ffmpeg the file with the token in a header, and refuses other paths", async () => {
    const client = createPlexClient({ url: "http://plex:32400", token: "t" });
    expect(client.fileSource("/library/parts/9/1/file.mkv")).toEqual({ url: "http://plex:32400/library/parts/9/1/file.mkv", headers: { "X-Plex-Token": "t" } });
    expect(() => client.fileSource("/:/prefs")).toThrow();
    await expect(client.image("/:/prefs")).rejects.toThrow();
  });
});
