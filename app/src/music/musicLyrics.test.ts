import { describe, expect, test } from "bun:test";
import lyricsPage from "./fixtures/ytm-lyrics.json";
import nextWithLyrics from "./fixtures/ytm-next-lyrics.json";
import nextWithoutLyrics from "./fixtures/ytm-next-no-lyrics.json";
import { createLrclibClient, firstArtist, parseLrc, plainTitle, type LrclibClient } from "./lrclib";
import { createMusicLyrics } from "./musicLyrics";
import type { MusicTrack } from "./youtubeMusicClient";
import { lyricsBrowseId, parseLyricsPage } from "./youtubeMusicLyricsParsers";

// The YouTube Music fixtures are trimmed real responses (WEB_REMIX, signed out, English)
// with the lyric text replaced by invented lines: real lyrics are copyrighted.

const track: MusicTrack = {
  videoId: "fJ9rUzIMcZQ", title: "Made-Up Song (Remastered 2011)", artist: "The Testers & Friend", artistId: null,
  album: "Fixtures", duration: 200, thumbnail: "", isTopic: true,
};

describe("YouTube Music lyrics parsers", () => {
  test("finds the Lyrics tab's page, and nothing when the tab is unselectable", () => {
    expect(lyricsBrowseId(nextWithLyrics)).toBe("MPLYt_wUbiMNbaE6O");
    expect(lyricsBrowseId(nextWithoutLyrics)).toBeNull();
    expect(lyricsBrowseId({})).toBeNull();
  });

  test("reads the lyrics and their credit", () => {
    const lyrics = parseLyricsPage(lyricsPage)!;
    expect(lyrics.text).toBe("First line of a made-up verse\nSecond line, still made up\n\nA chorus nobody wrote\nSung twice for the test");
    expect(lyrics.source).toBe("Source: Musixmatch");
    expect(parseLyricsPage({ contents: { sectionListRenderer: { contents: [{ messageRenderer: {} }] } } })).toBeNull();
  });
});

describe("LRC parsing", () => {
  test("reads timed lines in order, skipping tags and word stamps, and repeats a line with several stamps", () => {
    const lines = parseLrc("[ar:Someone]\r\n[00:01.50] First\n[00:10.00][01:02.25] Chorus <00:10.50>word\n[00:05] Second\n\n[00:20.00]\nnot timed");
    expect(lines).toEqual([
      { time: 1.5, text: "First" }, { time: 5, text: "Second" }, { time: 10, text: "Chorus word" }, { time: 20, text: "" }, { time: 62.25, text: "Chorus word" },
    ]);
  });

  test("tidies titles and artists the way LRCLIB lists them", () => {
    expect(plainTitle("Song (Official Video)")).toBe("Song");
    expect(plainTitle("Song [Remastered 2011]")).toBe("Song");
    expect(plainTitle("Song - 2011 Remaster")).toBe("Song");
    expect(plainTitle("(Untitled)")).toBe("(Untitled)");
    expect(firstArtist("A & B")).toBe("A");
    expect(firstArtist("A feat. B")).toBe("A");
    expect(firstArtist("Simon and Garfunkel")).toBe("Simon");
  });
});

describe("LRCLIB client", () => {
  test("sends only the song's details, and falls back to a search matched by length", async () => {
    const urls: string[] = [];
    const lrclib = createLrclibClient({
      fetch: async (url) => {
        urls.push(url);
        if (url.includes("/api/get")) return new Response("{}", { status: 404 });
        return Response.json([
          { trackName: "Made-Up Song", duration: 260, syncedLyrics: "[00:01.00] Too long" },
          { trackName: "Made-Up Song", duration: 201, plainLyrics: "Plain only" },
          { trackName: "Made-Up Song", duration: 198.5, syncedLyrics: "[00:01.00] Right one" },
        ]);
      },
    });
    const found = await lrclib.find(track);
    expect(found).toEqual({ synced: [{ time: 1, text: "Right one" }], plain: null, instrumental: false });
    expect(urls).toHaveLength(2);
    const exact = new URL(urls[0]!);
    expect(exact.origin + exact.pathname).toBe("https://lrclib.net/api/get");
    expect(Object.fromEntries(exact.searchParams)).toEqual({ artist_name: "The Testers", track_name: "Made-Up Song", duration: "200", album_name: "Fixtures" });
    expect(Object.fromEntries(new URL(urls[1]!).searchParams)).toEqual({ artist_name: "The Testers", track_name: "Made-Up Song" });
  });

  test("returns null when nothing matches, and throws when LRCLIB fails", async () => {
    const empty = createLrclibClient({ fetch: async (url) => url.includes("/api/get") ? new Response("", { status: 404 }) : Response.json([]) });
    expect(await empty.find(track)).toBeNull();
    const broken = createLrclibClient({ fetch: async () => new Response("", { status: 500 }) });
    await expect(broken.find(track)).rejects.toThrow("LRCLIB answered 500");
  });
});

function fakeLrclib(answer: () => Promise<Awaited<ReturnType<LrclibClient["find"]>>>) {
  let calls = 0;
  return { client: { find: () => { calls++; return answer(); } } satisfies LrclibClient, calls: () => calls };
}

describe("music lyrics", () => {
  const youtube = (text: string | null) => {
    let calls = 0;
    return { client: { lyrics: async () => { calls++; return text ? { text, source: "Source: Musixmatch" } : null; } }, calls: () => calls };
  };

  test("prefers LRCLIB's synced lyrics and does not ask YouTube Music then", async () => {
    const lrclib = fakeLrclib(async () => ({ synced: [{ time: 1, text: "Hi" }], plain: "Hi", instrumental: false }));
    const ytm = youtube("plain");
    const lyrics = await createMusicLyrics({ client: ytm.client, lrclib: lrclib.client }).get(1, track);
    expect(lyrics).toEqual({ videoId: track.videoId, synced: [{ time: 1, text: "Hi" }], plain: "Hi", instrumental: false, source: "LRCLIB" });
    expect(ytm.calls()).toBe(0);
  });

  test("falls back to YouTube Music's plain lyrics, then to LRCLIB's", async () => {
    const plainOnly = fakeLrclib(async () => ({ synced: null, plain: "From LRCLIB", instrumental: false }));
    expect(await createMusicLyrics({ client: youtube("From YouTube").client, lrclib: plainOnly.client }).get(1, track))
      .toMatchObject({ synced: null, plain: "From YouTube", source: "Source: Musixmatch" });
    expect(await createMusicLyrics({ client: youtube(null).client, lrclib: plainOnly.client }).get(1, track))
      .toMatchObject({ synced: null, plain: "From LRCLIB", source: "LRCLIB" });
    const failing = fakeLrclib(async () => { throw new Error("down"); });
    expect(await createMusicLyrics({ client: youtube("From YouTube").client, lrclib: failing.client }).get(1, track))
      .toMatchObject({ plain: "From YouTube" });
  });

  test("keeps answers, including none, and shares a lookup in flight; an outright failure is not kept", async () => {
    let time = 0;
    const lrclib = fakeLrclib(async () => null);
    const ytm = youtube(null);
    const lyrics = createMusicLyrics({ client: ytm.client, lrclib: lrclib.client, now: () => time });
    const [first, second] = await Promise.all([lyrics.get(1, track), lyrics.get(2, track)]);
    expect(first).toEqual({ videoId: track.videoId, synced: null, plain: null, instrumental: false, source: null });
    expect(second).toBe(first);
    await lyrics.get(1, track);
    expect(lrclib.calls()).toBe(1);
    time += 7 * 3_600_000;
    await lyrics.get(1, track);
    expect(lrclib.calls()).toBe(2);

    let up = false;
    const flaky = fakeLrclib(async () => { if (!up) throw new Error("down"); return { synced: null, plain: "Back", instrumental: false }; });
    const broken = { lyrics: async () => { if (!up) throw new Error("down"); return null; } };
    const retrying = createMusicLyrics({ client: broken, lrclib: flaky.client });
    await expect(retrying.get(1, track)).rejects.toThrow();
    up = true;
    expect((await retrying.get(1, track)).plain).toBe("Back");
  });
});
