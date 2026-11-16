import { describe, expect, test } from "bun:test";
import { YouTubeRefusalGate } from "../youtubeRateLimit";
import { createMusicLoudness, parseLoudnessDb } from "./musicLoudness";

const quiet = { info: () => {}, warn: () => {} };

describe("music loudness", () => {
  test("reads how far a song is above YouTube's target", () => {
    expect(parseLoudnessDb({ playerConfig: { audioConfig: { loudnessDb: 5.71, perceptualLoudnessDb: -8.29 } } })).toBe(5.71);
    // Without loudnessDb, the measured loudness against the target.
    expect(parseLoudnessDb({ playerConfig: { audioConfig: { trackAbsoluteLoudnessLkfs: -9.123, loudnessTargetLkfs: -14 } } })).toBe(4.88);
    expect(parseLoudnessDb({ playerConfig: { audioConfig: { trackAbsoluteLoudnessLkfs: -20 } } })).toBe(-6);
    expect(parseLoudnessDb({ playerConfig: { audioConfig: {} } })).toBeNull();
    expect(parseLoudnessDb({ playabilityStatus: { status: "UNPLAYABLE" } })).toBeNull();
    expect(parseLoudnessDb(null)).toBeNull();
    expect(parseLoudnessDb({ playerConfig: { audioConfig: { loudnessDb: 400 } } })).toBeNull();
  });

  test("asks YouTube once per song, as its iOS app", async () => {
    const asked: Array<{ url: string; body: any; agent: string }> = [];
    const loudness = createMusicLoudness({
      gate: new YouTubeRefusalGate(Date.now, quiet),
      fetch: async (url, init) => {
        asked.push({ url, body: JSON.parse(String(init?.body)), agent: new Headers(init?.headers).get("user-agent") ?? "" });
        return Response.json({ playerConfig: { audioConfig: { loudnessDb: 2.25 } } });
      },
    });
    expect(loudness.peek("songAAAAAA1")).toBeUndefined();
    const [first, second] = await Promise.all([loudness.get("songAAAAAA1"), loudness.get("songAAAAAA1")]);
    expect([first, second]).toEqual([2.25, 2.25]);
    expect(await loudness.get("songAAAAAA1")).toBe(2.25);
    expect(loudness.peek("songAAAAAA1")).toBe(2.25);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.url).toStartWith("https://www.youtube.com/youtubei/v1/player");
    expect(asked[0]!.body).toMatchObject({ videoId: "songAAAAAA1", context: { client: { clientName: "IOS" } } });
    expect(asked[0]!.agent).toStartWith("com.google.ios.youtube/");
    expect(await loudness.get("not an id")).toBeNull();
    expect(asked).toHaveLength(1);
  });

  test("remembers a song with no loudness for an hour, and asks again after", async () => {
    let now = 1_000_000;
    let calls = 0;
    const loudness = createMusicLoudness({
      now: () => now,
      gate: new YouTubeRefusalGate(() => now, quiet),
      fetch: async () => { calls++; return Response.json({ playabilityStatus: { status: "ERROR" } }); },
    });
    expect(await loudness.get("songAAAAAA1")).toBeNull();
    expect(await loudness.get("songAAAAAA1")).toBeNull();
    expect(calls).toBe(1);
    now += 3_600_001;
    expect(loudness.peek("songAAAAAA1")).toBeUndefined();
    await loudness.get("songAAAAAA1");
    expect(calls).toBe(2);
  });

  test("never throws, and stays quiet while YouTube refuses requests", async () => {
    const gate = new YouTubeRefusalGate(Date.now, quiet);
    let calls = 0;
    const refusing = createMusicLoudness({ gate, fetch: async () => { calls++; return new Response("slow down", { status: 429 }); } });
    expect(await refusing.get("songAAAAAA1")).toBeNull();
    // Not remembered, so the song is asked about again once YouTube answers.
    expect(refusing.peek("songAAAAAA1")).toBeUndefined();
    expect(await refusing.get("songBBBBBB1")).toBeNull();
    expect(calls).toBe(1);
    const failing = createMusicLoudness({ gate: new YouTubeRefusalGate(Date.now, quiet), fetch: async () => { throw new Error("offline"); } });
    expect(await failing.get("songAAAAAA1")).toBeNull();
  });
});
