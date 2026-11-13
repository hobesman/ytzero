import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-music-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const child = Bun.spawn([process.execPath, "app/tests/musicHarness.ts"], {
    cwd: resolve(import.meta.dir, "../../.."),
    env: { ...Bun.env, DB_PATH: resolve(root, "db", "source.db"), AVATAR_DIR: resolve(root, "avatars"), DOWNLOADS_DIR: resolve(root, "downloads") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Music harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Music harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
}, 120_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("music mode", () => {
  test("never touches the video catalog, history, progress, subscriptions or recommendations", () => {
    expect(result.after).toEqual(result.before);
  });

  test("talks to YouTube Music, not the video watch or info pages", () => {
    expect(result.youtubeRequests.length).toBeGreaterThan(0);
    for (const url of result.youtubeRequests) expect(url).toStartWith("https://music.youtube.com/");
  });

  test("searches and starts a station with its seed song", () => {
    expect(result.searchIds).toEqual(["seedSong001"]);
    expect(result.startStatus).toBe(200);
    expect(result.served).toHaveLength(5);
    expect(result.served[0]).toBe("seedSong001");
    expect(new Set(result.served).size).toBe(5);
  });

  test("serves a prepared song's first bytes without asking the audio host again", () => {
    expect(result.prepared).toBe(true);
    expect(result.preparedStatus).toBe(206);
    expect(result.preparedRange).toBe("bytes 0-1023/500000");
    expect(result.preparedFromMemory).toBe(true);
    expect(result.preparedOpenRange).toBe("bytes 0-499999/500000");
    expect(result.preparedOpenLength).toBe(500000);
    expect(result.headStatus).toBe(200);
    expect(result.unknownAudioStatus).toBe(404);
  });

  test("records plays and ratings idempotently and validates them", () => {
    expect(result.playStatus).toBe(200);
    expect(result.replayStatus).toBe(200);
    expect(result.musicPlays).toBe(2);
    expect(result.invalidPlayStatus).toBe(400);
    expect(result.likeStatus).toBe(200);
    expect(result.invalidRatingStatus).toBe(400);
    expect(result.invalidSeedStatus).toBe(400);
  });

  test("continues a station without repeats or not-this-one songs", () => {
    expect(result.nextStatus).toBe(200);
    expect(result.nextIds.length).toBeGreaterThan(0);
    for (const id of result.nextIds) expect(result.served).not.toContain(id);
    // The liked-songs station draws on the liked song's radio; the liked song
    // itself was just played, so fresher songs come first.
    expect(result.likedStationIds).toHaveLength(3);
    expect(result.likedStationIds).not.toContain(result.served[0]);
    expect(result.likedStationIds).not.toContain(result.served[2]);
  });

  test("keeps each profile's music library its own", () => {
    expect(result.likedIds).toEqual([result.served[0]]);
    expect(result.firstRating).toBe(1);
    expect(result.recentIds).toEqual([result.served[1], result.served[0]]);
    expect(result.otherLibrary).toEqual({ liked: [], recent: [] });
  });

  test("is not available to child profiles", () => {
    expect(result.childSearchStatus).toBe(403);
    expect(result.childStationStatus).toBe(403);
  });

  test("round-trips through backup, restores idempotently, and replaces on request", () => {
    expect(result.exported.ratings).toHaveLength(2);
    expect(result.exported.plays).toHaveLength(2);
    expect(result.exported.tracks.map((track: any) => track.video_id).sort()).toEqual([result.served[0], result.served[1], result.served[2]].sort());
    expect(result.restoredTwice).toEqual(result.exported);
    expect(result.replaced).toEqual(result.exported);
    expect(result.malformedSkipped).toBe(2);
  });
});
