import { describe, expect, test } from "bun:test";
import { describeAlexaExchange } from "./alexaLogging";

const VIDEO_ID = "vid00000001";

describe("alexa request logging", () => {
  test("names the request and what the skill did about it", () => {
    const envelope = { request: { type: "IntentRequest", intent: { name: "PlayVideoIntent", slots: { query: { value: "leaky faucet from this old house" } } } } };
    const played = {
      version: "1.0" as const,
      response: {
        outputSpeech: { type: "PlainText", text: "Playing Leaky Faucet from This Old House." },
        directives: [{
          type: "AudioPlayer.Play", playBehavior: "REPLACE_ALL",
          audioItem: { stream: { url: `https://yt.example.com/alexa/video-audio/${VIDEO_ID}?u=1&e=1&s=x`, offsetInMilliseconds: 125_000 }, metadata: { title: "Leaky Faucet", subtitle: "This Old House" } },
        }],
      },
    };
    expect(describeAlexaExchange("video", envelope, played)).toEqual({
      skill: "video", type: "IntentRequest", intent: "PlayVideoIntent", query: "leaky faucet from this old house",
      said: "Playing Leaky Faucet from This Old House.", action: "play", videoId: VIDEO_ID, title: "Leaky Faucet", by: "This Old House", from: 125,
    });
  });

  test("records a device's playback error and the skill's answer to it", () => {
    const failed = { request: { type: "AudioPlayer.PlaybackFailed", offsetInMilliseconds: 0, error: { type: "MEDIA_ERROR_SERVICE_UNAVAILABLE" } } };
    expect(describeAlexaExchange("music", failed, { version: "1.0", response: { directives: [{ type: "AudioPlayer.Stop" }], shouldEndSession: true } }))
      .toEqual({ skill: "music", type: "AudioPlayer.PlaybackFailed", position: 0, error: "MEDIA_ERROR_SERVICE_UNAVAILABLE", action: "stop" });
  });

  test("never logs the signed audio link itself", () => {
    const queued = {
      version: "1.0" as const,
      response: { directives: [{ type: "AudioPlayer.Play", playBehavior: "ENQUEUE", audioItem: { stream: { url: `https://yt.example.com/alexa/audio/${VIDEO_ID}?u=1&e=1&s=secret-signature` }, metadata: { title: "Song" } } }] },
    };
    const fields = describeAlexaExchange("music", { request: { type: "AudioPlayer.PlaybackNearlyFinished" } }, queued);
    expect(fields).toMatchObject({ action: "queue", videoId: VIDEO_ID });
    expect(JSON.stringify(fields)).not.toContain("secret-signature");
  });
});
