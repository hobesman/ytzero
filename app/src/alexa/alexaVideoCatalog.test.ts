import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-alexa-video-catalog-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const child = Bun.spawn([process.execPath, "app/tests/alexaVideoCatalogHarness.ts"], {
    cwd: resolve(import.meta.dir, "../../.."),
    env: { ...Bun.env, DB_PATH: resolve(root, "db", "source.db"), AVATAR_DIR: resolve(root, "avatars"), DOWNLOADS_DIR: resolve(root, "downloads") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Alexa video catalog harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Alexa video catalog harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
}, 120_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("alexa video catalog", () => {
  test("lists only followed channels, by the name the profile gave them", () => {
    expect(result.followed).toEqual([{ channelId: "UCfollowed", title: "This Old House" }]);
  });

  test("lists a channel's videos newest first, with what can be played and where to resume", () => {
    expect(result.videos.map((video: { videoId: string }) => video.videoId)).toEqual(["liveVideo01", "membersVid1", "shortVideo1", "newVideo001", "oldVideo001"]);
    const byId = Object.fromEntries(result.videos.map((video: { videoId: string }) => [video.videoId, video]));
    expect(byId.liveVideo01.playable).toBe(false);
    expect(byId.membersVid1.playable).toBe(false);
    expect(byId.shortVideo1.isShort).toBe(true);
    expect(result.newest).toMatchObject({ channelTitle: "This Old House", duration: 3600, resumeAt: 1200, playable: true });
    // Ten seconds in is close enough to the start to begin again.
    expect(byId.oldVideo001.resumeAt).toBeNull();
    expect(result.missing).toBeNull();
  });

  test("records progress and completion like the app's player, without touching subscriptions", () => {
    expect(result.progress).toEqual({ watch_position: 300, watch_duration: 600, watched: null });
    expect(result.finished).toEqual({ watched: 1 });
    expect(result.history).toBe(2);
    expect(result.subscriptions).toEqual([{ channel_id: "UCfollowed", followed: 1 }, { channel_id: "UCunfollowed", followed: 0 }]);
  });
});
