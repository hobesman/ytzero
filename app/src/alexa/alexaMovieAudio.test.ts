import { describe, expect, test } from "bun:test";
import { alexaMovieAudioLink, alexaMoviePosterLink, MOVIE_AUDIO_PATH, movieStreamArgs, verifyAlexaMovieAudioLink, verifyAlexaMoviePosterLink } from "./alexaMovieAudio";

const SECRET = "s".repeat(40);
const NOW = 1_800_000_000_000;

describe("links", () => {
  test("play as the profile signed into them, from an unsigned start", () => {
    const link = new URL(alexaMovieAudioLink("https://yt.example.com", SECRET, "101", 7, 3_600.25, NOW));
    expect(link.pathname).toBe("/alexa/movie-audio/101");
    expect(link.searchParams.get("t")).toBe("3600.25");
    expect(verifyAlexaMovieAudioLink(SECRET, "101", link.searchParams, NOW)).toBe(7);
    link.searchParams.set("t", "10");
    expect(verifyAlexaMovieAudioLink(SECRET, "101", link.searchParams, NOW)).toBe(7);
    expect(link.href.match(MOVIE_AUDIO_PATH)?.[1]).toBe("101");
  });

  test("refuse another item, another secret, an altered profile or an expired link", () => {
    const query = new URL(alexaMovieAudioLink("https://yt.example.com", SECRET, "101", 7, 0, NOW)).searchParams;
    expect(verifyAlexaMovieAudioLink(SECRET, "102", query, NOW)).toBeNull();
    expect(verifyAlexaMovieAudioLink("x".repeat(40), "101", query, NOW)).toBeNull();
    expect(verifyAlexaMovieAudioLink(SECRET, "101", new URLSearchParams({ ...Object.fromEntries(query), u: "8" }), NOW)).toBeNull();
    expect(verifyAlexaMovieAudioLink(SECRET, "101", query, NOW + 25 * 60 * 60_000)).toBeNull();
    expect(verifyAlexaMovieAudioLink(SECRET, "../etc", query, NOW)).toBeNull();
  });

  test("posters are signed per item", () => {
    const poster = new URL(alexaMoviePosterLink("https://yt.example.com", SECRET, "101"));
    expect(verifyAlexaMoviePosterLink(SECRET, "101", poster.searchParams)).toBe(true);
    expect(verifyAlexaMoviePosterLink(SECRET, "102", poster.searchParams)).toBe(false);
  });
});

describe("ffmpeg", () => {
  const source = { url: "http://plex:32400/library/parts/9/1/file.mkv", headers: { "X-Plex-Token": "t" } };

  test("mixes a 5.1 track down to stereo AAC, from the place asked for, with only that track", () => {
    const args = movieStreamArgs(source, { index: 2, codec: "dca", channels: 6, language: "eng", title: "", selected: true, default: true }, 3_600);
    expect(args.join(" ")).toContain("-headers X-Plex-Token: t\r\n -ss 3600 -i http://plex:32400/library/parts/9/1/file.mkv -map 0:2 -vn -sn -dn -ac 2 -c:a aac -b:a 160k -f mp4");
  });

  test("copies stereo AAC, and takes the first audio track when Plex names none", () => {
    expect(movieStreamArgs(source, { index: 1, codec: "aac", channels: 2, language: "", title: "", selected: false, default: false }, 0)).toContain("copy");
    const args = movieStreamArgs(source, null, 0);
    expect(args).not.toContain("-ss");
    expect(args.slice(args.indexOf("-map"), args.indexOf("-map") + 2)).toEqual(["-map", "0:a:0"]);
  });
});
