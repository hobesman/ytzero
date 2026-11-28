import { describe, expect, test } from "bun:test";
import { UNCHANGED, type AudioPlan } from "./alexaAudioPlan";
import { envelopeInVideoTime, livePosition, responseInEchoTime } from "./alexaAudioTimeline";
import type { AlexaResponse } from "./alexaPlayback";
import type { AlexaEnvelope } from "./alexaSkill";

const CUT: AudioPlan = { cuts: [{ start: 10, end: 20 }, { start: 50, end: 55 }], volumeDb: 0 };
const LEVELLED: AudioPlan = { cuts: [], volumeDb: -5 };
const PLANS: Record<string, AudioPlan> = { cutvideo123: CUT, levelled123: LEVELLED, untouched12: UNCHANGED };
const plans = { get: async (_u: number, _k: string, id: string) => PLANS[id] ?? UNCHANGED, peek: (_u: number, _k: string, id: string) => PLANS[id] ?? null };
const videoOf = (token: string) => token.replace(/^tok:/, "");

describe("places an Echo reports", () => {
  test("are turned into video time for a stream with cuts", () => {
    const envelope = {
      request: { type: "AudioPlayer.PlaybackStopped", token: "tok:cutvideo123", offsetInMilliseconds: 25_000 },
      context: { AudioPlayer: { token: "tok:cutvideo123", offsetInMilliseconds: 45_000 } },
    } as unknown as AlexaEnvelope;
    const seen = envelopeInVideoTime(envelope, 1, "video", plans, videoOf);
    expect(seen.request?.offsetInMilliseconds).toBe(35_000);
    expect(seen.context?.AudioPlayer?.offsetInMilliseconds).toBe(60_000);
    expect(envelope.request?.offsetInMilliseconds).toBe(25_000);
  });

  test("a failure's playback state is turned too", () => {
    const envelope = {
      request: { type: "AudioPlayer.PlaybackFailed", token: "tok:cutvideo123", currentPlaybackState: { token: "tok:cutvideo123", offsetInMilliseconds: 12_000 } },
    } as unknown as AlexaEnvelope;
    expect(envelopeInVideoTime(envelope, 1, "video", plans, videoOf).request?.currentPlaybackState?.offsetInMilliseconds).toBe(22_000);
  });

  test("are left alone with no cuts, or with no plan known", () => {
    for (const token of ["tok:levelled123", "tok:untouched12", "tok:unknown1234"]) {
      const envelope = { request: { type: "AudioPlayer.PlaybackStopped", token, offsetInMilliseconds: 25_000 } } as unknown as AlexaEnvelope;
      expect(envelopeInVideoTime(envelope, 1, "video", plans, videoOf)).toBe(envelope);
    }
  });
});

const play = (url: string, offset: number, behavior = "REPLACE_ALL") => ({
  type: "AudioPlayer.Play", playBehavior: behavior,
  audioItem: { stream: { url, token: "t", offsetInMilliseconds: offset }, metadata: { title: "x" } },
});
const answer = (...directives: unknown[]): AlexaResponse => ({ version: "1.0", response: { directives } } as unknown as AlexaResponse);
const link = (videoId: string, start: number) => `https://yt/alexa/video-audio/${videoId}/processed?t=${start}`;

describe("plays a skill sends", () => {
  test("become the processed stream, from the place asked, with the offset on the cut timeline", async () => {
    const sent = await responseInEchoTime(answer(play("https://yt/alexa/video-audio/cutvideo123/index.m3u8?t=30", 30_000)), 1, "video", plans, link);
    const stream = (sent.response.directives as any[])[0].audioItem.stream;
    expect(stream.url).toBe(link("cutvideo123", 30));
    expect(stream.offsetInMilliseconds).toBe(20_000);
    expect(stream.token).toBe("t");
  });

  test("a start inside a cut moves to its end", async () => {
    const sent = await responseInEchoTime(answer(play("https://yt/alexa/video-audio/cutvideo123/index.m3u8?t=12", 12_000)), 1, "video", plans, link);
    const stream = (sent.response.directives as any[])[0].audioItem.stream;
    expect(stream.url).toBe(link("cutvideo123", 20));
    expect(stream.offsetInMilliseconds).toBe(10_000);
  });

  test("a queued song is rewritten too, and a levelled one with no cuts keeps its place", async () => {
    const sent = await responseInEchoTime(answer(play("https://yt/alexa/audio/levelled123?u=1", 0, "ENQUEUE")), 1, "music", plans, link);
    const directive = (sent.response.directives as any[])[0];
    expect(directive.playBehavior).toBe("ENQUEUE");
    expect(directive.audioItem.stream.url).toBe(link("levelled123", 0));
    expect(directive.audioItem.stream.offsetInMilliseconds).toBe(0);
  });

  test("a stream with nothing to do, and other directives, are left as they are", async () => {
    const original = answer(play("https://yt/alexa/video-audio/untouched12/index.m3u8", 5_000), { type: "AudioPlayer.Stop" });
    expect(await responseInEchoTime(original, 1, "video", plans, link)).toBe(original);
  });
});

describe("the tablet's live position", () => {
  test("runs on the cut timeline, so a cut passed since the last report is jumped", () => {
    expect(livePosition(CUT, 5_000, 10_000)).toBe(25_000);
    expect(livePosition(CUT, 30_000, 25_000)).toBe(60_000);
    expect(livePosition(null, 5_000, 10_000)).toBe(15_000);
    expect(livePosition(LEVELLED, 5_000, 10_000)).toBe(15_000);
  });
});
