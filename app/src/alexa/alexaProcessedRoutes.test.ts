import { describe, expect, test } from "bun:test";
import type { MusicAudio } from "../music/musicAudio";
import { createAlexaRouter } from "../routes/alexaRoutes";
import { alexaAudioLink } from "./alexaAudioLinks";
import type { AudioPlan } from "./alexaAudioPlan";
import type { SpawnFfmpeg } from "./alexaBookAudio";
import type { AlexaConfig } from "./alexaConfig";
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
    const start = Number(range?.match(/^bytes=(\d+)-$/)?.[1] ?? 0);
    const end = Math.min(FILE.length, start + 4) - 1;
    return new Response(FILE.slice(start, end + 1), { status: 206, headers: { "Content-Type": "audio/mp4", "Content-Range": `bytes ${start}-${end}/${FILE.length}` } });
  },
} as unknown as MusicAudio;

function harness() {
  const spawned: string[][] = [];
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
    internalOrigin: "http://127.0.0.1:3999",
    spawn,
  });
  return { router, spawned };
}

describe("processed Echo audio", () => {
  test("streams ffmpeg's cut and levelled output from the place asked", async () => {
    const { router, spawned } = harness();
    const link = new URL(alexaProcessedAudioLink(settings.publicUrl, SECRET, VIDEO, 1, Date.now(), 15, "video"));
    const served = await router.request(`${link.pathname.replace(/^\/alexa/, "")}${link.search}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("audio/mp4");
    expect(await served.text()).toBe("ftyp");
    const args = spawned[0]!;
    expect(args[args.indexOf("-ss") + 1]).toBe("15");
    const input = new URL(args[args.indexOf("-i") + 1]!);
    expect(input.origin).toBe("http://127.0.0.1:3999");
    expect(input.pathname).toBe(`/alexa/video-audio/${VIDEO}`);
    expect(input.searchParams.get("whole")).toBe("1");
    expect(args[args.indexOf("-af") + 1]).toBe("aselect='not(between(t,0,5))',asetpts=N/SR/TB,volume=-3dB");
  });

  test("refuses a forged link and answers HEAD without starting ffmpeg", async () => {
    const { router, spawned } = harness();
    expect((await router.request(`/audio/${VIDEO}/processed?u=1&e=9999999999&s=forged`)).status).toBe(403);
    const link = new URL(alexaProcessedAudioLink(settings.publicUrl, SECRET, VIDEO, 1, Date.now(), 0, "video"));
    const head = await router.request(`/video-audio/${VIDEO}/processed${link.search}`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(spawned).toEqual([]);
  });

  test("the plain file, read by ffmpeg with whole ranges, answers each range to the end", async () => {
    const { router } = harness();
    const link = new URL(alexaAudioLink(settings.publicUrl, SECRET, VIDEO, 1, Date.now(), "video"));
    link.searchParams.set("whole", "1");
    const rest = await router.request(`/video-audio/${VIDEO}${link.search}`, { headers: { Range: "bytes=3-" } });
    expect(rest.status).toBe(206);
    expect(rest.headers.get("content-range")).toBe("bytes 3-9/10");
    expect(new Uint8Array(await rest.arrayBuffer())).toEqual(FILE.slice(3));
    link.searchParams.delete("whole");
    const piece = await router.request(`/video-audio/${VIDEO}${link.search}`, { headers: { Range: "bytes=3-" } });
    expect(new Uint8Array(await piece.arrayBuffer())).toEqual(FILE.slice(3, 7));
  });
});
