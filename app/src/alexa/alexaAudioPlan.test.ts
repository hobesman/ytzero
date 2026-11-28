import { describe, expect, test } from "bun:test";
import {
  createAlexaAudioPlans, createSponsorBlockSegments, isProcessed, levellingDb, mergeCuts, sponsorCategories, toEchoTime, toVideoTime, UNCHANGED,
} from "./alexaAudioPlan";

const CUTS = [{ start: 10, end: 20 }, { start: 50, end: 55 }];

describe("the cut timeline", () => {
  test("an Echo place leaves out every cut before it", () => {
    expect(toEchoTime(CUTS, 5)).toBe(5);
    expect(toEchoTime(CUTS, 15)).toBe(10);
    expect(toEchoTime(CUTS, 30)).toBe(20);
    expect(toEchoTime(CUTS, 60)).toBe(45);
  });

  test("a video place puts the cuts back, and a place at a cut's start is its end", () => {
    expect(toVideoTime(CUTS, 5)).toBe(5);
    expect(toVideoTime(CUTS, 10)).toBe(20);
    expect(toVideoTime(CUTS, 20)).toBe(30);
    expect(toVideoTime(CUTS, 45)).toBe(60);
  });

  test("a place outside the cuts survives the round trip", () => {
    for (const place of [0, 3, 25, 49.5, 56, 600]) expect(toVideoTime(CUTS, toEchoTime(CUTS, place))).toBe(place);
  });

  test("segments merge, sort, and anything under a second is left out", () => {
    expect(mergeCuts([{ start: 50, end: 60 }, { start: 10, end: 20 }, { start: 15, end: 25 }, { start: 25, end: 26 }, { start: 90, end: 90.5 }, { start: 30, end: 20 }]))
      .toEqual([{ start: 10, end: 26 }, { start: 50, end: 60 }]);
  });
});

describe("the profile's settings", () => {
  test("only songs above the target are turned down, and by no more than 30 dB", () => {
    expect(levellingDb(4.5)).toBe(-4.5);
    expect(levellingDb(-3)).toBe(0);
    expect(levellingDb(null)).toBe(0);
    expect(levellingDb(45)).toBe(-30);
  });

  test("SponsorBlock categories count only with it on, and junk is dropped", () => {
    const settings = (values: Record<string, string>) => (key: string) => values[key] ?? null;
    expect(sponsorCategories(settings({ sponsorblock_enabled: "0", sponsorblock_categories: '["sponsor"]' }))).toEqual([]);
    expect(sponsorCategories(settings({ sponsorblock_enabled: "1", sponsorblock_categories: '["sponsor","music_offtopic","Bad One",3]' }))).toEqual(["sponsor", "music_offtopic"]);
    expect(sponsorCategories(settings({ sponsorblock_enabled: "1", sponsorblock_categories: "not json" }))).toEqual([]);
  });
});

describe("a stream's plan", () => {
  const harness = (settings: Record<string, string>, overrides: { segments?: () => Promise<{ start: number; end: number }[]>; loudness?: () => Promise<number | null> } = {}) => {
    const calls = { segments: 0, loudness: 0 };
    const plans = createAlexaAudioPlans({
      segments: async () => { calls.segments += 1; return overrides.segments ? overrides.segments() : [{ start: 30, end: 40 }]; },
      loudness: async () => { calls.loudness += 1; return overrides.loudness ? overrides.loudness() : 6; },
      setting: (_userId, key) => settings[key] ?? null,
      waitMs: 50,
    });
    return { plans, calls };
  };

  test("music is cut and levelled; a video only cut", async () => {
    const { plans } = harness({ sponsorblock_enabled: "1", sponsorblock_categories: '["music_offtopic"]', music_volume_leveling: "1" });
    expect(await plans.get(1, "music", "aaaaaaaaaaa")).toEqual({ cuts: [{ start: 30, end: 40 }], volumeDb: -6 });
    expect(await plans.get(1, "video", "aaaaaaaaaaa")).toEqual({ cuts: [{ start: 30, end: 40 }], volumeDb: 0 });
  });

  test("with both settings off nothing is asked and nothing processed", async () => {
    const { plans, calls } = harness({ sponsorblock_enabled: "0", music_volume_leveling: "0" });
    const plan = await plans.get(1, "music", "aaaaaaaaaaa");
    expect(plan).toEqual(UNCHANGED);
    expect(isProcessed(plan)).toBe(false);
    expect(calls).toEqual({ segments: 0, loudness: 0 });
  });

  test("is decided once and kept, so the stream and its places agree", async () => {
    const { plans, calls } = harness({ sponsorblock_enabled: "1", sponsorblock_categories: '["sponsor"]' });
    expect(plans.peek(1, "video", "aaaaaaaaaaa")).toBe(null);
    const first = await plans.get(1, "video", "aaaaaaaaaaa");
    expect(await plans.get(1, "video", "aaaaaaaaaaa")).toBe(first);
    expect(plans.peek(1, "video", "aaaaaaaaaaa")).toBe(first);
    expect(calls.segments).toBe(1);
  });

  test("a slow or failing lookup doesn't hold up Alexa's answer", async () => {
    const { plans } = harness({ sponsorblock_enabled: "1", sponsorblock_categories: '["sponsor"]', music_volume_leveling: "1" }, {
      segments: () => new Promise(() => {}),
      loudness: async () => { throw new Error("no"); },
    });
    expect(await plans.get(1, "music", "aaaaaaaaaaa")).toEqual(UNCHANGED);
  });
});

describe("SponsorBlock's segments", () => {
  const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

  test("only skip segments of the asked categories count", async () => {
    const asked: string[] = [];
    const segments = createSponsorBlockSegments((async (url: string) => {
      asked.push(url);
      return answer(200, [
        { segment: [10, 20], category: "sponsor", actionType: "skip" },
        { segment: [30, 31], category: "sponsor", actionType: "mute" },
        { segment: [40, 50], category: "intro", actionType: "skip" },
        { segment: [60, 70], category: "sponsor" },
      ])();
    }) as unknown as typeof fetch);
    expect(await segments("aaaaaaaaaaa", ["sponsor"])).toEqual([{ start: 10, end: 20 }, { start: 60, end: 70 }]);
    expect(new URL(asked[0]!).searchParams.get("categories")).toBe('["sponsor"]');
  });

  test("a video with none is a 404, and both answers are kept", async () => {
    let calls = 0;
    const segments = createSponsorBlockSegments((async () => { calls += 1; return answer(404, "Not Found")(); }) as unknown as typeof fetch);
    expect(await segments("aaaaaaaaaaa", ["sponsor"])).toEqual([]);
    expect(await segments("aaaaaaaaaaa", ["sponsor"])).toEqual([]);
    expect(calls).toBe(1);
  });

  test("an unreachable SponsorBlock means no cuts", async () => {
    const segments = createSponsorBlockSegments((async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    expect(await segments("aaaaaaaaaaa", ["sponsor"])).toEqual([]);
  });
});
