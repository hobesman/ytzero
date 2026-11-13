import { describe, expect, test } from "bun:test";
import { createMusicAudio, MUSIC_PREPARE_BYTES } from "./musicAudio";
import { songKey } from "./musicSongKey";
import { ARTIST_COOLDOWN, pickStationTracks, type MusicSignals } from "./musicStationRanking";
import { largestThumbnail, parseDurationText, parseRadioResponse, parseSearchResponse } from "./youtubeMusicParsers";
import type { StoredMusicTrack } from "./musicCatalog";

const artistRun = (name: string, id: string) => ({
  text: name,
  navigationEndpoint: { browseEndpoint: { browseId: id, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ARTIST" } } } },
});
const albumRun = (name: string) => ({
  text: name,
  navigationEndpoint: { browseEndpoint: { browseId: "MPREb_x", browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ALBUM" } } } },
});
const watch = (videoId: string, type: string) => ({ watchEndpoint: { videoId, watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: type } } } });

describe("YouTube Music parsers", () => {
  test("reads a radio queue, keeps the primary of a wrapped pair, and drops repeats", () => {
    const panel = (videoId: string, title: string, type = "MUSIC_VIDEO_TYPE_ATV") => ({
      playlistPanelVideoRenderer: {
        videoId, title: { runs: [{ text: title }] }, lengthText: { runs: [{ text: "3:32" }] },
        longBylineText: { runs: [artistRun("Artist - Topic", "UCartist"), { text: " • " }, albumRun("Album"), { text: " • " }, { text: "2001" }] },
        thumbnail: { thumbnails: [{ url: "https://lh3.googleusercontent.com/a=w60-h60-l90-rj", width: 60 }, { url: "https://lh3.googleusercontent.com/a=w120-h120-l90-rj", width: 120 }] },
        navigationEndpoint: watch(videoId, type),
      },
    });
    const data = { contents: { playlistPanelRenderer: { contents: [
      panel("songAAAAAA1", "First"),
      { playlistPanelVideoWrapperRenderer: { primaryRenderer: panel("songBBBBBB2", "Second", "MUSIC_VIDEO_TYPE_OMV"), counterpart: [{ counterpartRenderer: panel("songCCCCCC3", "Second (audio)") }] } },
      panel("songAAAAAA1", "First again"),
      panel("bad", "Not a video id"),
    ] } } };
    const tracks = parseRadioResponse(data);
    expect(tracks.map((track) => track.videoId)).toEqual(["songAAAAAA1", "songBBBBBB2"]);
    expect(tracks[0]).toEqual({
      videoId: "songAAAAAA1", title: "First", artist: "Artist", artistId: "UCartist", album: "Album", duration: 212,
      thumbnail: "https://lh3.googleusercontent.com/a=w544-h544-l90-rj", isTopic: true,
    });
    expect(tracks[1].isTopic).toBe(false);
  });

  test("reads song search results with several artists and a duration", () => {
    const data = { contents: [{ musicResponsiveListItemRenderer: {
      playlistItemData: { videoId: "songDDDDDD4" },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Duet", navigationEndpoint: watch("songDDDDDD4", "MUSIC_VIDEO_TYPE_ATV") }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [artistRun("One", "UCone"), { text: " & " }, artistRun("Two", "UCtwo"), { text: " • " }, albumRun("Record"), { text: " • " }, { text: "4:05" }] } } },
      ],
    } }] };
    expect(parseSearchResponse(data)).toEqual([{
      videoId: "songDDDDDD4", title: "Duet", artist: "One, Two", artistId: "UCone", album: "Record", duration: 245, thumbnail: "", isTopic: true,
    }]);
  });

  test("parses durations and thumbnails defensively", () => {
    expect(parseDurationText("1:02:03")).toBe(3723);
    expect(parseDurationText("12 views")).toBeNull();
    expect(largestThumbnail(undefined)).toBe("");
    expect(largestThumbnail([{ url: "https://i.ytimg.com/vi/x/hq720.jpg", width: 800 }])).toBe("https://i.ytimg.com/vi/x/hq720.jpg");
  });
});

describe("song keys", () => {
  test("treat different uploads of one song as the same song", () => {
    const official = songKey("Daft Punk", "Daft Punk - One More Time (Official Video)");
    expect(songKey("Daft Punk", "One More Time")).toBe(official);
    expect(songKey("Daft Punk, Romanthony", "One More Time [Lyrics]")).toBe(official);
    expect(songKey("Daft Punk", "One More Time (Radio Edit)")).toBe(official);
    expect(songKey("Beyoncé", "Halo (feat. Someone)")).toBe(songKey("Beyonce", "Halo"));
    expect(songKey("Daft Punk", "One More Time (Live)")).not.toBe(official);
  });
});

function track(videoId: string, artist: string, extra: Partial<StoredMusicTrack> = {}): StoredMusicTrack {
  return {
    videoId, title: videoId, artist, artistId: `UC${artist}`, album: null, duration: 200, thumbnail: "", isTopic: false,
    songKey: `${artist}|${videoId}`, ...extra,
  };
}

const noSignals: MusicSignals = { ratings: new Map(), plays: [] };

describe("station picking", () => {
  test("keeps an artist out for the cooldown after it plays", () => {
    const radio = [track("a1", "A"), track("a2", "A"), track("a3", "A"), track("b1", "B"), track("c1", "C"), track("d1", "D")];
    const picked = pickStationTracks([radio], noSignals, { served: [], skipped: new Set() }, 4).map((item) => item.videoId);
    expect(picked).toEqual(["a1", "b1", "c1", "d1"]);
    expect(ARTIST_COOLDOWN).toBe(3);
  });

  test("drops not-this-one, songs already served, and other uploads of a served song", () => {
    const served = [track("s1", "S", { songKey: "s|song" })];
    const radio = [track("s2", "S", { songKey: "s|song" }), track("x1", "X"), track("y1", "Y"), track("z1", "Z")];
    const signals: MusicSignals = { ratings: new Map([["x1", -1]]), plays: [] };
    const picked = pickStationTracks([radio], signals, { served, skipped: new Set() }, 5).map((item) => item.videoId);
    expect(picked).toEqual(["y1", "z1"]);
  });

  test("ranks liked songs up and quickly skipped songs and session-skipped artists down", () => {
    const radio = [track("q1", "Q"), track("r1", "R"), track("l1", "L"), track("k1", "K")];
    const signals: MusicSignals = {
      ratings: new Map([["l1", 1]]),
      plays: [{ videoId: "q1", songKey: "Q|q1", artistKey: "UCQ", endReason: "skipped", listenedSeconds: 5 }],
    };
    const served = [track("r0", "R")];
    const picked = pickStationTracks([radio], signals, { served, skipped: new Set(["r0"]) }, 4).map((item) => item.videoId);
    expect(picked[0]).toBe("l1");
    expect(picked.indexOf("q1")).toBeGreaterThan(picked.indexOf("k1"));
    expect(picked.indexOf("r1")).toBeGreaterThan(picked.indexOf("k1"));
  });

  test("prefers songs not heard lately, but falls back to them when the pool runs dry", () => {
    const radio = [track("old", "O"), track("new", "N")];
    const signals: MusicSignals = { ratings: new Map(), plays: [{ videoId: "old", songKey: "O|old", artistKey: "UCO", endReason: "completed", listenedSeconds: 200 }] };
    expect(pickStationTracks([radio], signals, { served: [], skipped: new Set() }, 1).map((item) => item.videoId)).toEqual(["new"]);
    expect(pickStationTracks([radio], signals, { served: [], skipped: new Set() }, 2).map((item) => item.videoId)).toEqual(["new", "old"]);
  });

  test("keeps the best-scoring upload when sources overlap", () => {
    const video = track("vid", "V", { songKey: "v|song" });
    const topic = track("top", "V", { songKey: "v|song", isTopic: true });
    expect(pickStationTracks([[video], [topic]], noSignals, { served: [], skipped: new Set() }, 2).map((item) => item.videoId)).toEqual(["top"]);
  });
});

describe("prepared music audio", () => {
  const total = 1_000_000;
  function upstream() {
    const calls: Array<string | null> = [];
    const getAudioResponse = async (_userId: number, _videoId: string, range: string | null) => {
      calls.push(range);
      const match = range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = Number(match?.[1] ?? 0);
      const end = Math.min(match?.[2] ? Number(match[2]) : total - 1, total - 1);
      // Each byte names its position, so a stitched answer can be checked byte for byte.
      return new Response(Uint8Array.from({ length: end - start + 1 }, (_, index) => (start + index) % 251), {
        status: 206, headers: { "Content-Type": "audio/webm", "Content-Range": `bytes ${start}-${end}/${total}` },
      });
    };
    const getAudioHeadResponse = async () => new Response(null, { status: 200, headers: { "Content-Length": String(total) } });
    return { calls, getAudioResponse, getAudioHeadResponse };
  }

  test("answers the first request for a prepared song from memory", async () => {
    const source = upstream();
    const audio = createMusicAudio(source);
    expect(await audio.prepare(1, "songAAAAAA1")).toBe(true);
    expect(await audio.prepare(1, "songAAAAAA1")).toBe(true);
    expect(source.calls).toEqual([`bytes=0-${MUSIC_PREPARE_BYTES - 1}`]);

    // A request inside the prefix is answered from memory alone.
    const head = await audio.audio(1, "songAAAAAA1", "bytes=0-1023");
    expect(head?.headers.get("content-range")).toBe(`bytes 0-1023/${total}`);
    expect((await head!.arrayBuffer()).byteLength).toBe(1024);
    expect(source.calls).toHaveLength(1);

    // The player's open request gets the whole song: the prefix first, then the rest from upstream.
    const first = await audio.audio(1, "songAAAAAA1", "bytes=0-");
    expect(first?.status).toBe(206);
    expect(first?.headers.get("content-range")).toBe(`bytes 0-${total - 1}/${total}`);
    expect(first?.headers.get("content-length")).toBe(String(total));
    const bytes = new Uint8Array(await first!.arrayBuffer());
    expect(bytes.byteLength).toBe(total);
    expect(bytes.every((value, index) => value === index % 251)).toBe(true);
    expect(source.calls).toEqual([`bytes=0-${MUSIC_PREPARE_BYTES - 1}`, `bytes=${MUSIC_PREPARE_BYTES}-${total - 1}`]);

    // Another profile and unprepared songs go upstream.
    await audio.audio(2, "songAAAAAA1", "bytes=0-");
    expect(source.calls).toHaveLength(3);
    expect((await audio.head(1, "songAAAAAA1", null))?.headers.get("content-length")).toBe(String(total));
  });

  test("forgets a prepared prefix after it expires", async () => {
    const source = upstream();
    let clock = 0;
    const audio = createMusicAudio({ ...source, now: () => clock });
    await audio.prepare(1, "songAAAAAA1");
    clock = 4 * 60_000;
    await audio.audio(1, "songAAAAAA1", "bytes=0-");
    expect(source.calls).toHaveLength(2);
  });

  test("reports failure when the upstream has no audio", async () => {
    const audio = createMusicAudio({ getAudioResponse: async () => null, getAudioHeadResponse: async () => null });
    expect(await audio.prepare(1, "songAAAAAA1")).toBe(false);
  });
});
