import { describe, expect, test } from "bun:test";
import type { AlexaResponse } from "./alexaPlayback";
import type { AlexaEnvelope } from "./alexaSkill";
import type { ChannelCandidate } from "./alexaChannelDialog";
import { readOffer, spokenCount } from "./alexaChannelDialog";
import type { AlexaChannel, AlexaVideo } from "./alexaVideoCatalog";
import { createAlexaVideoSkill, encodeVideoToken } from "./alexaVideoSkill";

const FOUND: ChannelCandidate[] = [
  { channelId: "UC_toh_fan", title: "This Old House Fans", subscribers: "1.2K subscribers" },
  { channelId: "UC_oldhouse", title: "This Old House", subscribers: "2.1M subscribers" },
  { channelId: "UC_other", title: "Old Houses", subscribers: "" },
];
const PLAYING: AlexaVideo = {
  videoId: "vid00000001", title: "Faucet", channelId: "UC_rober", channelTitle: "Mark Rober", thumbnail: "",
  duration: 600, resumeAt: null, playable: true, isShort: false,
};

function harness(followed: AlexaChannel[] = [{ channelId: "UC_rober", title: "Mark Rober" }]) {
  const calls = { followed: [] as string[], unfollowed: [] as string[], searches: [] as string[] };
  const following = [...followed];
  const skill = createAlexaVideoSkill({
    followedChannels: async () => following,
    channelVideos: async () => [],
    findVideo: async (_userId, videoId) => videoId === PLAYING.videoId ? PLAYING : null,
    search: async () => [],
    importVideo: async () => {},
    audioLink: () => "",
    prepare: () => {},
    recordStarted: async () => {},
    recordProgress: async () => {},
    recordFinished: async () => {},
    channels: {
      searchChannels: async (_userId, query) => { calls.searches.push(query); return FOUND; },
      followedChannels: async () => following,
      follow: async (_userId, channel) => { calls.followed.push(channel.channelId); },
      unfollow: async (_userId, channelId) => { calls.unfollowed.push(channelId); },
    },
  });
  return { skill, calls };
}

const say = (name: string, query?: string, extra: { attributes?: Record<string, unknown>; playing?: boolean } = {}): AlexaEnvelope => ({
  context: extra.playing ? { AudioPlayer: { token: encodeVideoToken(PLAYING.videoId) } } : undefined,
  session: { attributes: extra.attributes },
  request: { type: "IntentRequest", intent: { name, slots: query ? { query: { value: query } } : {} } },
});
const speech = (response: AlexaResponse) => (response.response.outputSpeech as { text: string } | undefined)?.text;
/** Answers yes or no to the question in `previous`, as Alexa would, with its session attributes. */
const reply = (previous: AlexaResponse, yes: boolean) => say(yes ? "AMAZON.YesIntent" : "AMAZON.NoIntent", undefined, { attributes: previous.sessionAttributes });

describe("following channels by voice", () => {
  test("reads subscriber counts the way they're said", () => {
    expect(spokenCount("2.1M subscribers")).toBe("2.1 million subscribers");
    expect(spokenCount("850K subscribers")).toBe("850 thousand subscribers");
    expect(spokenCount("")).toBe("");
  });

  test("offers each match in turn and follows only on a yes", async () => {
    const { skill, calls } = harness();
    const first = await skill.handle(7, say("FindChannelIntent", "this old house"));
    expect(speech(first)).toBe("The first match is This Old House Fans, with 1.2 thousand subscribers. Follow it?");
    expect(first.response.shouldEndSession).toBe(false);
    const second = await skill.handle(7, reply(first, false));
    expect(speech(second)).toBe("The second match is This Old House, with 2.1 million subscribers. Follow it?");
    expect(calls.followed).toEqual([]);
    const done = await skill.handle(7, reply(second, true));
    expect(speech(done)).toBe("Now following This Old House.");
    expect(calls.followed).toEqual(["UC_oldhouse"]);
    expect(done.sessionAttributes).toBeUndefined();
  });

  test("says when it runs out of matches, having changed nothing", async () => {
    const { skill, calls } = harness();
    let response = await skill.handle(7, say("FindChannelIntent", "this old house"));
    for (let turn = 0; turn < 3; turn += 1) response = await skill.handle(7, reply(response, false));
    expect(speech(response)).toBe("That's all the matches I found. Nothing was changed.");
    expect(calls.followed).toEqual([]);
  });

  test("a match already followed is named as such, and yes moves on", async () => {
    const { skill, calls } = harness([{ channelId: "UC_toh_fan", title: "This Old House Fans" }]);
    const first = await skill.handle(7, say("FindChannelIntent", "this old house"));
    expect(speech(first)).toBe("The first match is This Old House Fans, with 1.2 thousand subscribers, which you already follow. Hear the next match?");
    expect(speech(await skill.handle(7, reply(first, true)))).toStartWith("The second match is This Old House");
    expect(calls.followed).toEqual([]);
  });

  test("follows the channel of the video playing, after a yes", async () => {
    const { skill, calls } = harness([]);
    const asked = await skill.handle(7, say("FollowCurrentIntent", undefined, { playing: true }));
    expect(speech(asked)).toBe("Follow Mark Rober?");
    await skill.handle(7, reply(asked, true));
    expect(calls.followed).toEqual(["UC_rober"]);
    // "follow this channel" heard as a search goes to the playing video's channel too.
    expect(speech(await skill.handle(7, say("FindChannelIntent", "this channel", { playing: true })))).toBe("Follow Mark Rober?");
    expect(speech(await skill.handle(7, say("FollowCurrentIntent")))).toStartWith("Nothing is playing");
  });

  test("unfollows a followed channel by name or the one playing, after a yes", async () => {
    const { skill, calls } = harness();
    const asked = await skill.handle(7, say("UnfollowChannelIntent", "marc robber"));
    expect(speech(asked)).toBe("Unfollow Mark Rober?");
    expect(speech(await skill.handle(7, reply(asked, false)))).toBe("Okay, nothing was changed.");
    expect(calls.unfollowed).toEqual([]);
    const current = await skill.handle(7, say("UnfollowCurrentIntent", undefined, { playing: true }));
    expect(speech(await skill.handle(7, reply(current, true)))).toBe("Unfollowed Mark Rober.");
    expect(calls.unfollowed).toEqual(["UC_rober"]);
    expect(speech(await skill.handle(7, say("UnfollowChannelIntent", "veritasium")))).toBe("You don't follow a channel called veritasium.");
  });

  test("a yes with no question pending, or a tampered offer, changes nothing", async () => {
    const { skill, calls } = harness();
    await skill.handle(7, say("AMAZON.YesIntent"));
    expect(readOffer({ channelOffer: { action: "follow", candidates: [{ channelId: "../x", title: "x" }], index: 0 } })).toBeNull();
    expect(readOffer({ channelOffer: { action: "delete", candidates: FOUND, index: 0 } })).toBeNull();
    expect(calls.followed).toEqual([]);
  });
});
