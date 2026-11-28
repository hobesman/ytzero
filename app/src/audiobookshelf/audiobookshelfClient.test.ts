import { describe, expect, test } from "bun:test";
import { audiobookshelfConfig, createAudiobookshelfClient, filterValue, parseBook, parseBookSummary } from "./audiobookshelfClient";

/** Shaped like GET /api/items/:id?expanded=1 from Audiobookshelf 2.38. */
const EXPANDED = {
  id: "li_abc123", libraryId: "lib1", mediaType: "book",
  media: {
    metadata: { title: "Dune", subtitle: null, authorName: "Frank Herbert", narratorName: "Scott Brick", series: [{ id: "ser_1", name: "Dune", sequence: "1" }] },
    duration: 75_600,
    chapters: [{ id: 1, start: 600, end: 75_600, title: "Book One" }, { id: 0, start: 0, end: 600, title: "Opening" }],
    audioFiles: [],
    tracks: [
      { index: 1, ino: "111", duration: 40_000, codec: "mp3", mimeType: "audio/mpeg", startOffset: 0 },
      { index: 2, ino: "222", duration: 35_600, codec: "mp3", mimeType: "audio/mpeg", startOffset: 40_000 },
    ],
  },
};

describe("parsing Audiobookshelf's books", () => {
  test("an expanded item becomes a book with tracks in play order and sorted chapters", () => {
    const book = parseBook(EXPANDED)!;
    expect(book.title).toBe("Dune");
    expect(book.author).toBe("Frank Herbert");
    expect(book.series).toEqual([{ id: "ser_1", name: "Dune", sequence: "1" }]);
    expect(book.tracks.map((track) => [track.index, track.ino, track.startOffset])).toEqual([[0, "111", 0], [1, "222", 40_000]]);
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Opening", "Book One"]);
  });

  test("without tracks, audio files in index order, leaving out excluded ones", () => {
    const book = parseBook({ ...EXPANDED, media: { ...EXPANDED.media, tracks: undefined, audioFiles: [
      { index: 2, ino: "b", duration: 10, codec: "aac" }, { index: 1, ino: "a", duration: 20, codec: "aac" }, { index: 3, ino: "x", duration: 5, exclude: true },
    ] } })!;
    expect(book.tracks.map((track) => [track.ino, track.startOffset])).toEqual([["a", 0], ["b", 20]]);
  });

  test("a podcast or a book with no audio is not a book", () => {
    expect(parseBook({ ...EXPANDED, mediaType: "podcast" })).toBeNull();
    expect(parseBook({ ...EXPANDED, media: { ...EXPANDED.media, tracks: [], audioFiles: [] } })).toBeNull();
    expect(parseBookSummary({ id: "li_e", mediaType: "book", media: { metadata: { title: "Ebook" }, numTracks: 0, duration: 0 } })).toBeNull();
  });

  test("filter values are encoded as the web client does", () => {
    expect(filterValue("ser_1")).toBe(encodeURIComponent(Buffer.from("ser_1").toString("base64")));
  });
});

describe("configuration", () => {
  test("off until both variables are set", () => {
    expect(audiobookshelfConfig({})).toEqual({ disabled: "YTZERO_AUDIOBOOKSHELF_URL and YTZERO_AUDIOBOOKSHELF_API_KEY are not set" });
    expect(audiobookshelfConfig({ YTZERO_AUDIOBOOKSHELF_URL: "http://abs:80" })).toEqual({ disabled: "YTZERO_AUDIOBOOKSHELF_API_KEY is not set" });
    expect(audiobookshelfConfig({ YTZERO_AUDIOBOOKSHELF_URL: "\"http://127.0.0.1:8089/\"", YTZERO_AUDIOBOOKSHELF_API_KEY: "key" }))
      .toEqual({ url: "http://127.0.0.1:8089", apiKey: "key" });
  });
});

describe("the API", () => {
  test("sends the key as a bearer token, and saves progress with currentTime, duration and progress", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const client = createAudiobookshelfClient({ url: "http://abs", apiKey: "secret-key" }, async (url, init) => {
      calls.push({ url, init });
      return new Response(null, { status: 200 });
    });
    await client.saveProgress("li_abc123", { currentTime: 3_600, duration: 7_200 });
    expect(calls[0]!.url).toBe("http://abs/api/me/progress/li_abc123");
    expect(calls[0]!.init?.method).toBe("PATCH");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ currentTime: 3_600, duration: 7_200, progress: 0.5 });
  });

  test("a refused key and a missing book are told apart", async () => {
    const refused = createAudiobookshelfClient({ url: "http://abs", apiKey: "k" }, async () => new Response("no", { status: 401 }));
    await expect(refused.bookLibraries()).rejects.toThrow("Audiobookshelf refused the API key");
    const missing = createAudiobookshelfClient({ url: "http://abs", apiKey: "k" }, async () => new Response("no", { status: 404 }));
    expect(await missing.book("li_gone")).toBeNull();
    expect(await missing.progress("li_gone")).toBeNull();
  });

  test("books in progress leave out podcast episodes", async () => {
    const client = createAudiobookshelfClient({ url: "http://abs", apiKey: "k" }, async () => Response.json({ libraryItems: [
      { id: "li_1", mediaType: "book", progressLastUpdate: 5, media: { metadata: { title: "A", authorName: "X" }, numTracks: 1, duration: 100 } },
      { id: "li_2", mediaType: "podcast", recentEpisode: { id: "ep" }, media: { metadata: { title: "Pod" } } },
    ] }));
    expect(await client.inProgress()).toEqual([{ id: "li_1", libraryId: "", title: "A", author: "X", seriesName: null, duration: 100, numChapters: 0, lastUpdate: 5 }]);
  });
});
