import { describe, expect, test } from "bun:test";
import type { AlexaResponse } from "./alexaPlayback";
import type { AlexaEnvelope } from "./alexaSkill";
import { envelopeWithoutStreamStarts, responseWithStreamStarts, withoutStreamStart, withStreamStart } from "./alexaStreamTokens";

const play = (token: string, offsetInMilliseconds: number, extra: Record<string, unknown> = {}) => ({
  type: "AudioPlayer.Play", playBehavior: "REPLACE_ALL",
  audioItem: { stream: { url: "https://yt.example.com/alexa/video-audio/abc", token, offsetInMilliseconds, ...extra } },
});
const answer = (...directives: unknown[]): AlexaResponse => ({ version: "1.0", response: { directives } } as unknown as AlexaResponse);
const streamOf = (response: AlexaResponse, index = 0) => (response.response.directives as any[])[index].audioItem.stream;

describe("stream tokens carry their start", () => {
  test("a suffix of the start, which comes off again", () => {
    expect(withStreamStart("yv1.FYpor757sJg", 399_000)).toBe(`yv1.FYpor757sJg~${(399_000).toString(36)}`);
    expect(withStreamStart(withStreamStart("yv1.FYpor757sJg", 399_000), 0)).toBe("yv1.FYpor757sJg~0");
    expect(withoutStreamStart(withStreamStart("yz1.eyJzIjp7fX0", 5))).toBe("yz1.eyJzIjp7fX0");
    expect(withoutStreamStart("hb1.li_abc.2")).toBe("hb1.li_abc.2");
  });

  test("a resume from a new place gets a token of its own, so the Echo fetches the new stream", () => {
    const paused = withStreamStart("yv1.FYpor757sJg", 359_000);
    const envelope = { context: { AudioPlayer: { token: paused, offsetInMilliseconds: 408_000 } }, request: { type: "IntentRequest" } } as AlexaEnvelope;
    const sent = responseWithStreamStarts(answer(play("yv1.FYpor757sJg", 399_000)), envelope);
    expect(streamOf(sent).token).not.toBe(paused);
    expect(withoutStreamStart(streamOf(sent).token)).toBe("yv1.FYpor757sJg");
  });

  test("a queued Play expects the token the Echo really holds", () => {
    const held = withStreamStart("yv1.aaaaaaaaaaa", 120_000);
    const envelope = { request: { type: "AudioPlayer.PlaybackNearlyFinished", token: held } } as AlexaEnvelope;
    const sent = responseWithStreamStarts(answer({ ...play("yv1.bbbbbbbbbbb", 0, { expectedPreviousToken: "yv1.aaaaaaaaaaa" }), playBehavior: "ENQUEUE" }), envelope);
    expect(streamOf(sent).expectedPreviousToken).toBe(held);
    expect(streamOf(sent).token).toBe("yv1.bbbbbbbbbbb~0");
  });

  test("the skills see their own tokens in every place a request names one", () => {
    const token = withStreamStart("hb1.li_abc.2", 60_000);
    const seen = envelopeWithoutStreamStarts({
      context: { AudioPlayer: { token, offsetInMilliseconds: 61_000 } },
      request: { type: "AudioPlayer.PlaybackFailed", token, currentPlaybackState: { token, offsetInMilliseconds: 61_000 } },
    } as AlexaEnvelope);
    expect(seen.context?.AudioPlayer?.token).toBe("hb1.li_abc.2");
    expect(seen.request?.token).toBe("hb1.li_abc.2");
    expect(seen.request?.currentPlaybackState?.token).toBe("hb1.li_abc.2");
    expect(seen.context?.AudioPlayer?.offsetInMilliseconds).toBe(61_000);
  });

  test("an answer with no Play is left alone", () => {
    const response = answer({ type: "AudioPlayer.Stop" });
    expect(responseWithStreamStarts(response, {} as AlexaEnvelope)).toBe(response);
  });
});
