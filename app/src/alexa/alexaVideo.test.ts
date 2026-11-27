import { describe, expect, test } from "bun:test";
import type { SearchResult } from "../youtube";
import type { AlexaEnvelope } from "./alexaSkill";
import type { AlexaChannel, AlexaVideo } from "./alexaVideoCatalog";
import {
  bestMatch, CHANNEL_MATCH_MIN, channelScore, durationSeconds, fromSplits, isoDurationSeconds, TITLE_MATCH_MIN, titleScore,
} from "./alexaVideoMatch";
import { createAlexaVideoSkill, decodeVideoToken, encodeVideoToken } from "./alexaVideoSkill";

const id = (n: number) => `vid${String(n).padStart(8, "0")}`;

const CHANNELS: AlexaChannel[] = [
  { channelId: "UC_oldhouse", title: "This Old House" },
  { channelId: "UC_rober", title: "Mark Rober" },
  { channelId: "UC_ted", title: "TED" },
  { channelId: "UC_teded", title: "TED-Ed" },
  { channelId: "UC_america", title: "America's Test Kitchen" },
];

const video = (n: number, extra: Partial<AlexaVideo> = {}): AlexaVideo => ({
  videoId: id(n), title: `Video ${n}`, channelId: "UC_oldhouse", channelTitle: "This Old House", thumbnail: "https://i.ytimg.com/x.jpg",
  duration: 600, resumeAt: null, playable: true, isShort: false, ...extra,
});

describe("matching what Alexa heard", () => {
  const channel = (spoken: string) => bestMatch(spoken, CHANNELS, (item) => item.title, channelScore, CHANNEL_MATCH_MIN)?.item.title ?? null;

  test("finds followed channels despite spelling, punctuation and near-misses", () => {
    expect(channel("this old house")).toBe("This Old House");
    expect(channel("marc robber")).toBe("Mark Rober");
    expect(channel("ted")).toBe("TED");
    expect(channel("ted ed")).toBe("TED-Ed");
    expect(channel("americas test kitchen")).toBe("America's Test Kitchen");
    expect(channel("veritasium")).toBeNull();
    expect(channel("house")).toBeNull();
  });

  test("finds a title from part of it, preferring the first (newest) on a tie", () => {
    const titles = ["How To Fix A Leaky Faucet | Ask This Old House", "Replacing a Kitchen Faucet", "Leaky Faucet Repair (2015)"];
    const title = (spoken: string) => bestMatch(spoken, titles, (item) => item, titleScore, TITLE_MATCH_MIN)?.item ?? null;
    expect(title("how to fix a leaky faucet")).toBe(titles[0]);
    expect(title("leaky faucet")).toBe(titles[0]);
    expect(title("kitchen faucet")).toBe(titles[1]);
    expect(title("installing drywall")).toBeNull();
  });

  test("reads every '<title> from <channel>', the last 'from' first", () => {
    expect(fromSplits("letter from america from this old house")).toEqual([
      { title: "letter from america", channel: "this old house" },
      { title: "letter", channel: "america from this old house" },
    ]);
    expect(fromSplits("from this old house")).toEqual([]);
    expect(fromSplits("a video")).toEqual([]);
  });

  test("reads durations", () => {
    expect(durationSeconds("12:34")).toBe(754);
    expect(durationSeconds("1:02:03")).toBe(3723);
    expect(durationSeconds("")).toBeNull();
    expect(isoDurationSeconds("PT30S")).toBe(30);
    expect(isoDurationSeconds("PT1M30S")).toBe(90);
    expect(isoDurationSeconds("PT2M")).toBe(120);
    expect(isoDurationSeconds("P1D")).toBeNull();
  });
});

function harness(options: { videos?: Record<string, AlexaVideo[]>; search?: SearchResult[]; resume?: string[] } = {}) {
  const catalog = new Map<string, AlexaVideo>();
  for (const list of Object.values(options.videos ?? {})) for (const item of list) catalog.set(item.videoId, item);
  const calls = { searches: [] as string[], imported: [] as string[], started: [] as string[], progress: [] as [string, number, number | null][], finished: [] as string[] };
  const skill = createAlexaVideoSkill({
    followedChannels: async () => CHANNELS,
    channelVideos: async (_userId, channelId) => options.videos?.[channelId] ?? [],
    findVideo: async (_userId, videoId) => catalog.get(videoId) ?? null,
    search: async (_userId, query) => { calls.searches.push(query); return options.search ?? []; },
    importVideo: async (_userId, videoId) => {
      calls.imported.push(videoId);
      const result = options.search?.find((item) => item.videoId === videoId);
      if (result) catalog.set(videoId, video(99, { videoId, title: result.title, channelId: result.channelId, channelTitle: result.channelTitle }));
    },
    audioLink: (videoId, userId) => `https://yt.example.com/alexa/video-audio/${videoId}?u=${userId}`,
    prepare: () => {},
    recordStarted: async (_userId, videoId) => { calls.started.push(videoId); },
    recordProgress: async (_userId, videoId, position, duration) => { calls.progress.push([videoId, position, duration]); },
    recordFinished: async (_userId, videoId) => { calls.finished.push(videoId); },
    resumeCandidates: async () => options.resume ?? [],
  });
  return { skill, calls };
}

const say = (name: string, slots: Record<string, string> = {}, player?: { token: string; offsetInMilliseconds?: number }): AlexaEnvelope => ({
  context: { AudioPlayer: player },
  request: { type: "IntentRequest", intent: { name, slots: Object.fromEntries(Object.entries(slots).map(([key, value]) => [key, { value }])) } },
});
const event = (type: string, token: string, offsetInMilliseconds = 0): AlexaEnvelope => ({ request: { type, token, offsetInMilliseconds } });
type Play = { type: string; audioItem: { stream: { url: string; token: string; offsetInMilliseconds: number } } };
const directive = (response: { response: Record<string, unknown> }) => (response.response.directives as Play[] | undefined)?.[0];
const speech = (response: { response: Record<string, unknown> }) => (response.response.outputSpeech as { text: string } | undefined)?.text;
const result = (n: number, extra: Partial<SearchResult> = {}): SearchResult => ({
  videoId: id(n), title: `Result ${n}`, thumbnail: "", duration: "10:00", channelId: "UC_other", channelTitle: "Someone",
  channelAvatar: null, viewCount: null, published: null, ...extra,
});

describe("alexa video skill", () => {
  const faucet = video(1, { title: "How To Fix A Leaky Faucet | Ask This Old House" });
  const drywall = video(2, { title: "Hanging Drywall" });

  test("plays a followed channel's video by name", async () => {
    const { skill, calls } = harness({ videos: { UC_oldhouse: [drywall, faucet] } });
    const response = await skill.handle(7, say("PlayVideoIntent", { query: "leaky faucet from this old house" }));
    expect(speech(response)).toBe("Playing How To Fix A Leaky Faucet | Ask This Old House from This Old House.");
    expect(directive(response)?.audioItem.stream).toMatchObject({ url: `https://yt.example.com/alexa/video-audio/${id(1)}?u=7`, token: encodeVideoToken(id(1)), offsetInMilliseconds: 0 });
    expect(calls.searches).toEqual([]);
  });

  test("resumes where the profile left off", async () => {
    const { skill } = harness({ videos: { UC_oldhouse: [video(1, { title: "Leaky Faucet", resumeAt: 125 })] } });
    const response = await skill.handle(7, say("PlayVideoIntent", { query: "leaky faucet from this old house" }));
    expect(speech(response)).toBe("Resuming Leaky Faucet from This Old House, where you left off.");
    expect(directive(response)?.audioItem.stream.offsetInMilliseconds).toBe(125_000);
  });

  test("searches YouTube within the channel when the title isn't in the catalog", async () => {
    const { skill, calls } = harness({
      videos: { UC_oldhouse: [drywall] },
      search: [result(5, { title: "Faucet copy", channelId: "UC_other" }), result(6, { title: "Old Faucet Episode", channelId: "UC_oldhouse", channelTitle: "This Old House" })],
    });
    const response = await skill.handle(7, say("PlayVideoIntent", { query: "the 1987 faucet episode from this old house" }));
    expect(calls.searches).toEqual(["the 1987 faucet episode This Old House"]);
    expect(calls.imported).toEqual([id(6)]);
    expect(decodeVideoToken(directive(response)?.audioItem.stream.token)).toBe(id(6));
  });

  test("without a followed channel, plays YouTube's top result that isn't live", async () => {
    const { skill, calls } = harness({ search: [result(5, { duration: "" }), result(6)] });
    const response = await skill.handle(7, say("PlayVideoIntent", { query: "letter from america" }));
    expect(calls.searches).toEqual(["letter from america"]);
    expect(decodeVideoToken(directive(response)?.audioItem.stream.token)).toBe(id(6));
  });

  test("says so when nothing matches", async () => {
    const { skill } = harness();
    expect(speech(await skill.handle(7, say("PlayVideoIntent", { query: "nothing at all" })))).toBe("I couldn't find a video called nothing at all.");
    expect(speech(await skill.handle(7, say("PlayLatestIntent", { query: "veritasium" })))).toBe("You don't follow a channel called veritasium.");
  });

  test("plays the latest video from a channel, skipping Shorts and live", async () => {
    const { skill } = harness({ videos: { UC_rober: [video(3, { isShort: true }), video(4, { playable: false }), video(5, { title: "Glitter Bomb", channelTitle: "Mark Rober" })] } });
    const response = await skill.handle(7, say("PlayLatestIntent", { query: "mark rober" }));
    expect(speech(response)).toBe("Playing Glitter Bomb from Mark Rober.");
  });

  test("skips forward and back within the video", async () => {
    const { skill } = harness({ videos: { UC_oldhouse: [faucet] } });
    const token = encodeVideoToken(id(1));
    const forward = directive(await skill.handle(7, say("SkipForwardIntent", { duration: "PT2M" }, { token, offsetInMilliseconds: 60_000 })));
    expect(forward?.audioItem.stream.offsetInMilliseconds).toBe(180_000);
    const back = directive(await skill.handle(7, say("SkipBackIntent", {}, { token, offsetInMilliseconds: 10_000 })));
    expect(back?.audioItem.stream.offsetInMilliseconds).toBe(0);
    const pastEnd = directive(await skill.handle(7, say("SkipForwardIntent", { duration: "PT1H" }, { token, offsetInMilliseconds: 0 })));
    expect(pastEnd?.audioItem.stream.offsetInMilliseconds).toBe(599_000);
  });

  test("counts listening as watching: one start, progress on stop, completion at the end", async () => {
    const { skill, calls } = harness({ videos: { UC_oldhouse: [faucet] } });
    const token = encodeVideoToken(id(1));
    await skill.handle(7, event("AudioPlayer.PlaybackStarted", token));
    await skill.handle(7, event("AudioPlayer.PlaybackStopped", token, 90_400));
    await skill.handle(7, event("AudioPlayer.PlaybackStarted", token, 90_400));
    await skill.handle(7, event("AudioPlayer.PlaybackFinished", token, 600_000));
    expect(calls.started).toEqual([id(1)]);
    expect(calls.progress).toEqual([[id(1), 90, 600]]);
    expect(calls.finished).toEqual([id(1)]);
  });

  test("a stream that ends well before the video does keeps its place instead of counting as watched", async () => {
    const { skill, calls } = harness({ videos: { UC_oldhouse: [faucet] } });
    const token = encodeVideoToken(id(1));
    await skill.handle(7, event("AudioPlayer.PlaybackFinished", token, 518_000));
    expect(calls.finished).toEqual([]);
    expect(calls.progress).toEqual([[id(1), 518, 600]]);
    await skill.handle(7, event("AudioPlayer.PlaybackFinished", token, 580_000));
    expect(calls.finished).toEqual([id(1)]);
  });

  test("resume with nothing on the Echo picks up the last unfinished video where it stopped", async () => {
    const watched = video(2, { watched: true, resumeAt: null });
    const partway = video(3, { resumeAt: 870 });
    const { skill } = harness({ videos: { UC_oldhouse: [watched, partway] }, resume: [id(2), id(3)] });
    const resumed = await skill.handle(7, say("AMAZON.ResumeIntent"));
    expect(speech(resumed)).toBe("Resuming Video 3 from This Old House, where you left off.");
    expect(directive(resumed)?.audioItem.stream).toMatchObject({ token: encodeVideoToken(id(3)), offsetInMilliseconds: 870_000 });

    const { skill: empty } = harness({ videos: { UC_oldhouse: [watched] }, resume: [id(2)] });
    expect(speech(await empty.handle(7, say("AMAZON.ResumeIntent")))).toBe("Nothing is playing. Which video would you like to hear?");
    // Start over still needs a video on the Echo.
    const { skill: again } = harness({ videos: { UC_oldhouse: [partway] }, resume: [id(3)] });
    expect(directive(await again.handle(7, say("AMAZON.StartOverIntent")))).toBeUndefined();
  });

  test("pause stops, resume continues, and audio events never speak", async () => {
    const { skill } = harness({ videos: { UC_oldhouse: [faucet] } });
    const token = encodeVideoToken(id(1));
    expect(directive(await skill.handle(7, say("AMAZON.PauseIntent")))?.type).toBe("AudioPlayer.Stop");
    expect(directive(await skill.handle(7, say("AMAZON.ResumeIntent", {}, { token, offsetInMilliseconds: 42_000 })))?.audioItem.stream.offsetInMilliseconds).toBe(42_000);
    for (const type of ["AudioPlayer.PlaybackNearlyFinished", "AudioPlayer.PlaybackFailed", "PlaybackController.NextCommandIssued"]) {
      expect(speech(await skill.handle(7, { ...event(type, token), context: { AudioPlayer: { token } } }))).toBeUndefined();
    }
  });
});
