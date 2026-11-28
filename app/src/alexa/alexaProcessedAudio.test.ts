import { describe, expect, test } from "bun:test";
import { verifyAlexaAudioLink } from "./alexaAudioLinks";
import { alexaProcessedAudioLink, cutsFrom, processedFilter, processedStreamArgs } from "./alexaProcessedAudio";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-27T12:00:00Z");
const PLAN = { cuts: [{ start: 10, end: 20 }, { start: 50, end: 55 }], volumeDb: -4.3 };

describe("processed audio", () => {
  test("its link is signed like the plain file's, with the start free", () => {
    const link = new URL(alexaProcessedAudioLink("https://yt.example.com", SECRET, "aaaaaaaaaaa", 7, NOW, 90.5, "video"));
    expect(link.pathname).toBe("/alexa/video-audio/aaaaaaaaaaa/processed");
    expect(link.searchParams.get("t")).toBe("90.5");
    expect(verifyAlexaAudioLink(SECRET, "aaaaaaaaaaa", link.searchParams, NOW, "video")).toBe(7);
    expect(verifyAlexaAudioLink(SECRET, "aaaaaaaaaaa", link.searchParams, NOW, "music")).toBe(null);
    expect(new URL(alexaProcessedAudioLink("https://yt.example.com", SECRET, "aaaaaaaaaaa", 7, NOW, 0, "music")).searchParams.has("t")).toBe(false);
  });

  test("cuts are measured from the start; ones behind it are gone", () => {
    expect(cutsFrom(PLAN.cuts, 0)).toEqual(PLAN.cuts);
    expect(cutsFrom(PLAN.cuts, 30)).toEqual([{ start: 20, end: 25 }]);
    expect(cutsFrom(PLAN.cuts, 15)).toEqual([{ start: 0, end: 5 }, { start: 35, end: 40 }]);
  });

  test("the filter drops the cuts, closes up the time, then turns the volume down", () => {
    expect(processedFilter(PLAN, 0)).toBe("aselect='not(between(t,10,20)+between(t,50,55))',asetpts=N/SR/TB,volume=-4.3dB");
    expect(processedFilter({ cuts: PLAN.cuts, volumeDb: 0 }, 60)).toBe(null);
    expect(processedFilter({ cuts: [], volumeDb: -2 }, 0)).toBe("volume=-2dB");
  });

  test("the stream starts where asked and is AAC in fragmented MP4", () => {
    const args = processedStreamArgs("http://127.0.0.1:3001/alexa/audio/x", 30, PLAN);
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4)).toEqual(["-ss", "30", "-i", "http://127.0.0.1:3001/alexa/audio/x"]);
    expect(args[args.indexOf("-af") + 1]).toBe("aselect='not(between(t,20,25))',asetpts=N/SR/TB,volume=-4.3dB");
    expect(args.slice(args.indexOf("-c:a"), args.indexOf("-c:a") + 2)).toEqual(["-c:a", "aac"]);
    expect(args.slice(args.indexOf("-f"), args.indexOf("-f") + 2)).toEqual(["-f", "mp4"]);
    expect(processedStreamArgs("in", 0, PLAN)).not.toContain("-ss");
  });
});
