import { beforeEach, describe, expect, test } from "bun:test";
import {
  activeSubtitleLines, cueText, defaultSubtitleTrack, loadSubtitleMemory, matchSubtitleTrack, orderSubtitleTracks, parseSubtitleMemory,
  parseSubtitles, resetSubtitleMemory, saveSubtitleMemory, SUBTITLE_CHOICE_KEY, subtitleAppearance, type SubtitleTrack,
} from "./subtitles";

const track = (lang: string): SubtitleTrack => ({ lang, url: `/api/videos/x/subtitles/${lang}` });

describe("parseSubtitles", () => {
  test("reads WebVTT cues with settings, ids, notes and styles", () => {
    const parsed = parseSubtitles("﻿WEBVTT\r\nKind: captions\r\n\r\nNOTE a comment\r\n\r\nSTYLE\r\n::cue { color: red }\r\n\r\n"
      + "intro\r\n00:00:01.000 --> 00:00:03.500 align:start position:0%\r\n<v Narrator>Hello</v> &amp; welcome\r\n\r\n"
      + "01:02:03.250 --> 01:02:04.000\r\nSecond <i>line</i>\r\nthird&nbsp;line\r\n");
    expect(parsed.cues).toEqual([
      { start: 1, end: 3.5, lines: ["Hello & welcome"] },
      { start: 3723.25, end: 3724, lines: ["Second line", "third line"] },
    ]);
  });

  test("reads SRT and skips malformed or empty cues", () => {
    const parsed = parseSubtitles("1\n00:00:01,000 --> 00:00:02,000\nOne\n\n2\nnot a time --> nope\nBad\n\n3\n00:00:05,000 --> 00:00:04,000\nBackwards\n\n4\n00:00:06,000 --> 00:00:07,000\n \n\n5\n00:10.5 --> 00:11.000\nShort form");
    expect(parsed.cues).toEqual([{ start: 1, end: 2, lines: ["One"] }, { start: 10.5, end: 11, lines: ["Short form"] }]);
  });

  test("strips YouTube's karaoke timing tags and decodes numeric entities", () => {
    expect(cueText("hello<00:00:00.320><c> there</c><00:00:00.640><c> friend</c>")).toBe("hello there friend");
    expect(cueText("it&#39;s &#x263A; &unknown;")).toBe("it's ☺ &unknown;");
  });

  test("sorts cues by start", () => {
    const parsed = parseSubtitles("WEBVTT\n\n00:00:05.000 --> 00:00:06.000\nLater\n\n00:00:01.000 --> 00:00:02.000\nEarlier");
    expect(parsed.cues.map((cue) => cue.lines[0])).toEqual(["Earlier", "Later"]);
  });
});

describe("activeSubtitleLines", () => {
  const parsed = parseSubtitles(`WEBVTT

00:00:01.000 --> 00:00:03.000
First

00:00:02.000 --> 00:00:20.000
Long

00:00:04.000 --> 00:00:05.000
Third

00:00:30.000 --> 00:00:31.000
Last`);

  test("shows every cue covering the time, in start order", () => {
    expect(activeSubtitleLines(parsed, 0.5)).toEqual([]);
    expect(activeSubtitleLines(parsed, 1)).toEqual(["First"]);
    expect(activeSubtitleLines(parsed, 2.5)).toEqual(["First", "Long"]);
    // An end is exclusive.
    expect(activeSubtitleLines(parsed, 3)).toEqual(["Long"]);
    expect(activeSubtitleLines(parsed, 4.2)).toEqual(["Long", "Third"]);
    expect(activeSubtitleLines(parsed, 25)).toEqual([]);
    expect(activeSubtitleLines(parsed, 30.5)).toEqual(["Last"]);
    expect(activeSubtitleLines(parsed, 99)).toEqual([]);
  });

  test("follows a seek backwards or forwards, since it keeps no state", () => {
    expect(activeSubtitleLines(parsed, 30.5)).toEqual(["Last"]);
    expect(activeSubtitleLines(parsed, 1.5)).toEqual(["First"]);
  });

  test("shows a line repeated by rolling automatic captions once", () => {
    // Each cue holds a line of one space, as YouTube writes them.
    const rolling = parseSubtitles("WEBVTT\n\n00:00:00.000 --> 00:00:02.880 align:start position:0%\n \nhello<00:00:00.320><c> there</c>\n\n"
      + "00:00:02.880 --> 00:00:02.890 align:start position:0%\nhello there\n \n\n"
      + "00:00:02.890 --> 00:00:05.000 align:start position:0%\nhello there\nhow<00:00:03.100><c> are</c><00:00:03.400><c> you</c>");
    expect(activeSubtitleLines(rolling, 1)).toEqual(["hello there"]);
    expect(activeSubtitleLines(rolling, 2.885)).toEqual(["hello there"]);
    expect(activeSubtitleLines(rolling, 4)).toEqual(["hello there", "how are you"]);
  });

  test("has nothing for an empty track or a time the player cannot give", () => {
    expect(activeSubtitleLines(parseSubtitles(""), 1)).toEqual([]);
    expect(activeSubtitleLines(parsed, Number.NaN)).toEqual([]);
  });
});

describe("track choice", () => {
  const tracks = [track("de"), track("en-US"), track("fr")];

  test("matches a language exactly, then by its base language", () => {
    expect(matchSubtitleTrack(tracks, "en-US")?.lang).toBe("en-US");
    expect(matchSubtitleTrack(tracks, "en")?.lang).toBe("en-US");
    expect(matchSubtitleTrack(tracks, "EN_gb")?.lang).toBe("en-US");
    expect(matchSubtitleTrack([track("en"), track("en-orig")], "en-orig")?.lang).toBe("en-orig");
    expect(matchSubtitleTrack(tracks, "ja")).toBeNull();
    expect(matchSubtitleTrack(tracks, null)).toBeNull();
  });

  test("starts off unless the profile turns captions on", () => {
    expect(defaultSubtitleTrack(tracks, { remembered: null, playerCcLang: "en" })).toBeNull();
    expect(defaultSubtitleTrack(tracks, { remembered: null, playerCc: "1", playerCcLang: "fr" })?.lang).toBe("fr");
    // The interface language stands in for a caption language the video lacks.
    expect(defaultSubtitleTrack(tracks, { remembered: null, playerCc: "1", playerCcLang: "ja", playerHl: "de" })?.lang).toBe("de");
    expect(defaultSubtitleTrack(tracks, { remembered: null, playerCc: "1", playerCcLang: "ja" })).toBeNull();
  });

  test("puts the viewer's last choice before the profile's default", () => {
    expect(defaultSubtitleTrack(tracks, { remembered: "off", playerCc: "1", playerCcLang: "fr" })).toBeNull();
    expect(defaultSubtitleTrack(tracks, { remembered: "de", playerCc: "0" })?.lang).toBe("de");
    // A remembered language this video lacks falls back to the profile's languages.
    expect(defaultSubtitleTrack(tracks, { remembered: "ja", playerCcLang: "fr" })?.lang).toBe("fr");
    expect(defaultSubtitleTrack(tracks, { remembered: "ja" })).toBeNull();
  });

  test("lets a channel ban captions or force a language", () => {
    expect(defaultSubtitleTrack(tracks, { channelMode: "off", remembered: "de", playerCc: "1", playerCcLang: "fr" })).toBeNull();
    expect(defaultSubtitleTrack(tracks, { channelMode: "language", channelLanguage: "de", remembered: "off" })?.lang).toBe("de");
    // A forced language the video lacks leaves the usual choice.
    expect(defaultSubtitleTrack(tracks, { channelMode: "language", channelLanguage: "ja", remembered: "fr" })?.lang).toBe("fr");
  });

  test("has nothing to choose without tracks", () => {
    expect(defaultSubtitleTrack([], { remembered: "en", playerCc: "1", playerCcLang: "en" })).toBeNull();
  });

  test("lists the profile's languages first", () => {
    expect(orderSubtitleTracks(tracks, ["fr", null, "en", "fr", "ja"]).map((item) => item.lang)).toEqual(["fr", "en-US", "de"]);
  });
});

describe("remembered choice", () => {
  beforeEach(resetSubtitleMemory);
  const store = (initial: Record<string, string> = {}) => {
    const values = new Map(Object.entries(initial));
    let reads = 0;
    return {
      values, reads: () => reads,
      getItemAsync: async (key: string) => { reads += 1; return values.get(key) ?? null; },
      setItemAsync: async (key: string, value: string) => { values.set(key, value); },
    };
  };

  test("accepts off or a language code and ignores anything else", () => {
    expect(parseSubtitleMemory("off")).toBe("off");
    expect(parseSubtitleMemory("pt-BR")).toBe("pt-BR");
    expect(parseSubtitleMemory("")).toBeNull();
    expect(parseSubtitleMemory("../x")).toBeNull();
    expect(parseSubtitleMemory(null)).toBeNull();
  });

  test("is read once and saved on the device", async () => {
    const memory = store({ [SUBTITLE_CHOICE_KEY]: "de" });
    expect(await loadSubtitleMemory(memory)).toBe("de");
    expect(await loadSubtitleMemory(memory)).toBe("de");
    expect(memory.reads()).toBe(1);
    await saveSubtitleMemory(memory, "off");
    expect(memory.values.get(SUBTITLE_CHOICE_KEY)).toBe("off");
    expect(await loadSubtitleMemory(memory)).toBe("off");
  });

  test("keeps a choice made before the first read finished", async () => {
    const memory = store({ [SUBTITLE_CHOICE_KEY]: "de" });
    await saveSubtitleMemory(memory, "fr");
    expect(await loadSubtitleMemory(memory)).toBe("fr");
  });

  test("starts with no choice when the store fails", async () => {
    expect(await loadSubtitleMemory({ getItemAsync: async () => { throw new Error("locked"); }, setItemAsync: async () => {} })).toBeNull();
  });
});

describe("subtitleAppearance", () => {
  test("follows the profile's size, colour and backdrop", () => {
    expect(subtitleAppearance(null)).toEqual({ scale: 1, color: "#ffffff", background: "rgba(0, 0, 0, 0.75)" });
    expect(subtitleAppearance({ player_sub_size: "38", player_sub_color: "#FFFF00", player_sub_bg: "0" })).toEqual({ scale: 2, color: "#FFFF00", background: "rgba(0, 0, 0, 0)" });
    expect(subtitleAppearance({ player_sub_size: "small" }).scale).toBeCloseTo(14 / 19);
    expect(subtitleAppearance({ player_sub_size: "999", player_sub_color: "red", player_sub_bg: "x" })).toEqual({ scale: 48 / 19, color: "#ffffff", background: "rgba(0, 0, 0, 0.75)" });
  });
});
