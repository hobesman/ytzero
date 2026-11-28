import { describe, expect, test } from "bun:test";
import { captionLines, pickCaptions } from "./roomCaptions";

describe("room captions", () => {
  test("reads cues, without tags, each line once even when YouTube's captions roll", () => {
    const vtt = [
      "WEBVTT", "Kind: captions", "Language: en", "",
      "00:00:01.000 --> 00:00:03.000 align:start position:0%", "hello<00:00:01.500><c> there</c>", "",
      "00:00:03.000 --> 00:00:03.010", "hello there", "", // the brief repeat
      "00:00:03.010 --> 00:00:05.000", "hello there", "Rock &amp; roll", "",
      "1:02:03.500 --> 1:02:05.000", "<i>much later</i>",
    ].join("\r\n");
    expect(captionLines(vtt)).toEqual([
      { time: 1, text: "hello there" },
      { time: 3.01, text: "Rock & roll" },
      { time: 3723.5, text: "much later" },
    ]);
    expect(captionLines("WEBVTT\n\nnot a cue")).toEqual([]);
  });

  test("picks the page's language, then English, then any", () => {
    const track = (lang: string) => ({ lang, url: `/api/videos/x/subtitles/${lang}` });
    expect(pickCaptions([track("de"), track("en"), track("pl")], "pl")?.lang).toBe("pl");
    expect(pickCaptions([track("en-US"), track("pt-BR")], "pt-PT")?.lang).toBe("pt-BR");
    expect(pickCaptions([track("de"), track("en-orig")], "ja")?.lang).toBe("en-orig");
    expect(pickCaptions([track("de")], "ja")?.lang).toBe("de");
    expect(pickCaptions([], "en")).toBe(null);
  });
});
