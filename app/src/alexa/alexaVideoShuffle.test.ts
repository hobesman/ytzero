import { describe, expect, test } from "bun:test";
import type { AlexaEnvelope } from "./alexaSkill";
import type { AlexaVideo } from "./alexaVideoCatalog";
import { createAlexaVideoSkill, decodeVideoToken } from "./alexaVideoSkill";
import { decodeShuffleToken, encodeShuffleToken, pickRandomVideo, SHUFFLE_PLAYED_LIMIT } from "./alexaVideoShuffle";

const id = (n: number) => `vid${String(n).padStart(8, "0")}`;
const video = (n: number, extra: Partial<AlexaVideo> = {}): AlexaVideo => ({
  videoId: id(n), title: `Video ${n}`, channelId: "UC_rober", channelTitle: "Mark Rober", thumbnail: "https://i.ytimg.com/x.jpg",
  duration: 600, resumeAt: null, playable: true, isShort: false, ...extra,
});
const UPLOADS = [video(1), video(2), video(3, { isShort: true }), video(4, { playable: false }), video(5, { watched: true })];

function harness(videos = UPLOADS) {
  return createAlexaVideoSkill({
    followedChannels: async () => [{ channelId: "UC_rober", title: "Mark Rober" }],
    channelVideos: async () => videos,
    findVideo: async (_userId, videoId) => videos.find((item) => item.videoId === videoId) ?? null,
    search: async () => [],
    importVideo: async () => {},
    audioLink: (videoId) => `https://yt.example.com/alexa/video-audio/${videoId}`,
    prepare: () => {},
    recordStarted: async () => {},
    recordProgress: async () => {},
    recordFinished: async () => {},
  });
}

const say = (name: string, query?: string, token?: string): AlexaEnvelope => ({
  context: token ? { AudioPlayer: { token, offsetInMilliseconds: 30_000 } } : undefined,
  request: { type: "IntentRequest", intent: { name, slots: query ? { query: { value: query } } : {} } },
});
type Play = { type: string; playBehavior: string; audioItem: { stream: { token: string; offsetInMilliseconds: number; expectedPreviousToken?: string } } };
const directive = (response: { response: Record<string, unknown> }) => (response.response.directives as Play[] | undefined)?.[0];
const speech = (response: { response: Record<string, unknown> }) => (response.response.outputSpeech as { text: string } | undefined)?.text;

describe("shuffled videos from a channel", () => {
  test("tokens carry the channel and what played, and stay under Alexa's limit", () => {
    const state = { channelId: "UCabcdefghijklmnopqrstuv", videoId: id(1), played: Array.from({ length: 100 }, (_, n) => id(n + 10)) };
    const token = encodeShuffleToken(state);
    expect(token.length).toBeLessThan(1024);
    expect(decodeShuffleToken(token)).toEqual({ ...state, played: state.played.slice(-SHUFFLE_PLAYED_LIMIT) });
    expect(decodeVideoToken(token)).toBe(id(1));
    expect(decodeShuffleToken("yvs.UC.x")).toBeNull();
    expect(decodeShuffleToken(`yv1.${id(1)}`)).toBeNull();
  });

  test("picks an unplayed, unwatched upload, never a Short or a live stream", () => {
    expect(pickRandomVideo(UPLOADS, [], () => 0)?.videoId).toBe(id(1));
    expect(pickRandomVideo(UPLOADS, [], () => 0.99)?.videoId).toBe(id(2));
    expect(pickRandomVideo(UPLOADS, [id(1), id(2)], () => 0)?.videoId).toBe(id(5));
    // Once everything has played, it starts over, but not with the video just heard.
    expect(pickRandomVideo(UPLOADS, [id(1), id(2), id(5)], () => 0)?.videoId).toBe(id(1));
    expect(pickRandomVideo([video(3, { isShort: true })], [])).toBeNull();
  });

  test("a shuffle queues another video from the channel as each one nears its end", async () => {
    const skill = harness();
    const started = await skill.handle(7, say("ShuffleChannelIntent", "the channel mark rober"));
    expect(speech(started)).toStartWith("Shuffling Mark Rober, starting with Video ");
    const first = directive(started)!;
    const state = decodeShuffleToken(first.audioItem.stream.token)!;
    expect(state).toMatchObject({ channelId: "UC_rober", played: [] });

    const queued = directive(await skill.handle(7, { request: { type: "AudioPlayer.PlaybackNearlyFinished", token: first.audioItem.stream.token } }))!;
    expect(queued.playBehavior).toBe("ENQUEUE");
    expect(queued.audioItem.stream.expectedPreviousToken).toBe(first.audioItem.stream.token);
    const after = decodeShuffleToken(queued.audioItem.stream.token)!;
    expect(after.played).toEqual([state.videoId]);
    expect(after.videoId).not.toBe(state.videoId);

    const skipped = directive(await skill.handle(7, say("AMAZON.NextIntent", undefined, queued.audioItem.stream.token)))!;
    expect(skipped.playBehavior).toBe("REPLACE_ALL");
    expect(decodeShuffleToken(skipped.audioItem.stream.token)?.played).toEqual([state.videoId, after.videoId]);

    // Skipping within a video keeps the shuffle going.
    const forward = directive(await skill.handle(7, say("SkipForwardIntent", undefined, skipped.audioItem.stream.token)))!;
    expect(forward.audioItem.stream.token).toBe(skipped.audioItem.stream.token);
  });

  test("a random video plays once, with nothing queued after it", async () => {
    const skill = harness();
    const started = await skill.handle(7, say("RandomVideoIntent", "mark rober"));
    expect(speech(started)).toStartWith("Playing Video ");
    const token = directive(started)!.audioItem.stream.token;
    expect(decodeShuffleToken(token)).toBeNull();
    expect(directive(await skill.handle(7, { request: { type: "AudioPlayer.PlaybackNearlyFinished", token } }))).toBeUndefined();
    expect(speech(await skill.handle(7, say("ShuffleChannelIntent", "veritasium")))).toBe("You don't follow a channel called veritasium.");
  });
});
