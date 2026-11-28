import { describe, expect, test } from "bun:test";
import type { MusicAudio } from "../music/musicAudio";
import { createAlexaRouter } from "../routes/alexaRoutes";
import type { AudioPlan } from "./alexaAudioPlan";
import type { SpawnFfmpeg } from "./alexaBookAudio";
import type { AlexaConfig } from "./alexaConfig";
import type { LoopbackAudio, LoopbackSource } from "./alexaLoopbackAudio";
import { alexaProcessedAudioLink } from "./alexaProcessedAudio";

const SECRET = "a-test-secret-that-is-long-enough-123456";
const VIDEO = "abcdefghijk";
const settings: AlexaConfig = { musicSkillId: "amzn1.ask.skill.test", videoSkillId: "amzn1.ask.skill.video", profile: "1", secret: SECRET, publicUrl: "https://yt.example.com" };
const PLAN: AudioPlan = { cuts: [{ start: 10, end: 20 }], volumeDb: -3 };

const FILE = Uint8Array.from({ length: 10 }, (_, index) => index);
/** The shared proxy: four bytes an answer. */
const audio = {
  prepare: async () => true,
  head: async () => null,
  audio: async (_userId: number, _videoId: string, range: string | null) => {
    const start = Number(range?.match(/^bytes=(\d+)-/)?.[1] ?? 0);
    const end = Math.min(FILE.length, start + 4) - 1;
    return new Response(FILE.slice(start, end + 1), { status: 206, headers: { "Content-Type": "audio/mp4", "Content-Range": `bytes ${start}-${end}/${FILE.length}` } });
  },
} as unknown as MusicAudio;

function harness() {
  const spawned: string[][] = [];
  const links: { source: LoopbackSource; closed: boolean }[] = [];
  const loopbackAudio: LoopbackAudio = {
    link: async (source) => {
      const entry = { source, closed: false };
      links.push(entry);
      return { url: `http://127.0.0.1:3999/key${links.length}`, close: () => { entry.closed = true; } };
    },
  };
  const spawn: SpawnFfmpeg = (args) => {
    spawned.push(args);
    return {
      stdout: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("ftyp")); controller.close(); } }),
      stderr: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
      kill: () => {},
      exited: Promise.resolve(0),
    };
  };
  const router = createAlexaRouter({
    config: () => settings,
    isChild: async () => false,
    videoPlayable: async () => true,
    audio: async () => ({ audio, ytdlpAvailable: async () => true }),
    audioPlans: { get: async () => PLAN, peek: () => PLAN },
    loopbackAudio,
    spawn,
  });
  return { router, spawned, links };
}

describe("processed Echo audio", () => {
  test("streams ffmpeg's cut and levelled output from the place asked", async () => {
    const { router, spawned, links } = harness();
    const link = new URL(alexaProcessedAudioLink(settings.publicUrl, SECRET, VIDEO, 1, Date.now(), 15, "video"));
    const served = await router.request(`${link.pathname.replace(/^\/alexa/, "")}${link.search}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("audio/mp4");
    expect(await served.text()).toBe("ftyp");
    const args = spawned[0]!;
    expect(args[args.indexOf("-ss") + 1]).toBe("15");
    expect(args[args.indexOf("-i") + 1]).toBe("http://127.0.0.1:3999/key1");
    expect(args[args.indexOf("-af") + 1]).toBe("aselect='not(between(t,0,5))',asetpts=N/SR/TB,volume=-3dB");
    // ffmpeg is done with its input once its output ends.
    expect(links[0]!.closed).toBe(true);
  });

  test("refuses a forged link and answers HEAD without starting ffmpeg", async () => {
    const { router, spawned } = harness();
    expect((await router.request(`/audio/${VIDEO}/processed?u=1&e=9999999999&s=forged`)).status).toBe(403);
    const link = new URL(alexaProcessedAudioLink(settings.publicUrl, SECRET, VIDEO, 1, Date.now(), 0, "video"));
    const head = await router.request(`/video-audio/${VIDEO}/processed${link.search}`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(spawned).toEqual([]);
  });

  test("ffmpeg's input answers each range to the file's end, with the file's length", async () => {
    const { router, links } = harness();
    const link = new URL(alexaProcessedAudioLink(settings.publicUrl, SECRET, VIDEO, 1, Date.now(), 0, "video"));
    await (await router.request(`/video-audio/${VIDEO}/processed${link.search}`)).text();
    const source = links[0]!.source;
    const signal = new AbortController().signal;
    const whole = (await source(null, signal))!;
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-length")).toBe("10");
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(FILE);
    const rest = (await source("bytes=3-", signal))!;
    expect(rest.status).toBe(206);
    expect(rest.headers.get("content-range")).toBe("bytes 3-9/10");
    expect(new Uint8Array(await rest.arrayBuffer())).toEqual(FILE.slice(3));
    // Any other range goes to the proxy as it is.
    expect(new Uint8Array(await (await source("bytes=3-4", signal))!.arrayBuffer())).toEqual(FILE.slice(3, 7));
  });
});
