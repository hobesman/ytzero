import { describe, expect, test } from "bun:test";
import { createDirectStreamPrefetcher, UP_NEXT_PREFETCH_COUNT } from "./directStreamPrefetch";
import type { PlaybackContext } from "./playbackContext";

const feed = { kind: "feed", sort: "published", tags: [], showAll: false } as unknown as PlaybackContext;
const order = ["a", "b", "c", "d", "e", "f"];

function setup(options: { eligible?: (videoId: string) => boolean; ready?: Set<string> } = {}) {
  const prepared: string[] = [];
  const lookups: string[] = [];
  let running = 0;
  let maxRunning = 0;
  const releases: Array<() => void> = [];
  const prefetcher = createDirectStreamPrefetcher({
    delayMs: 0,
    eligible: async (_userId, videoId) => options.eligible?.(videoId) ?? true,
    ready: (_userId, videoId) => options.ready?.has(videoId) ?? false,
    prepare: async (_userId, videoId) => {
      prepared.push(videoId);
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise<void>((resolve) => releases.push(resolve));
      running--;
      return "playlist";
    },
    nextVideoId: async (_userId, videoId) => {
      lookups.push(videoId);
      return order[order.indexOf(videoId) + 1] ?? null;
    },
  });
  const settle = async () => {
    for (let round = 0; round < 20; round++) {
      await Bun.sleep(1);
      releases.splice(0).forEach((release) => release());
    }
  };
  return { prefetcher, prepared, lookups, settle, maxRunning: () => maxRunning };
}

describe("up-next stream prefetch", () => {
  test("prepares the next video and the ones after it, a few at a time", async () => {
    const { prefetcher, prepared, settle, maxRunning } = setup();
    await prefetcher.prefetchUpNext(1, "b", feed, "oldest");
    await settle();
    expect(prepared).toEqual(order.slice(1, 1 + UP_NEXT_PREFETCH_COUNT));
    expect(maxRunning()).toBeLessThanOrEqual(2);
  });

  test("skips videos that are already prepared or cannot stream, but still looks past them", async () => {
    const { prefetcher, prepared, settle } = setup({ ready: new Set(["b"]), eligible: (videoId) => videoId !== "c" });
    await prefetcher.prefetchUpNext(1, "b", feed, "oldest");
    await settle();
    expect(prepared).toEqual(["d"]);
  });

  test("does not prepare a video twice while it is still being prepared", async () => {
    const { prefetcher, prepared, settle } = setup();
    await prefetcher.prefetchUpNext(1, "b", feed, "oldest");
    await prefetcher.prefetchUpNext(1, "c", feed, "oldest");
    await settle();
    expect(prepared.filter((videoId) => videoId === "c")).toHaveLength(1);
    expect(prepared.filter((videoId) => videoId === "d")).toHaveLength(1);
  });

  test("a channel playlist prepares only its first next video, without asking YouTube for the order again", async () => {
    const { prefetcher, prepared, lookups, settle } = setup();
    const playlist = { kind: "channel-playlist", playlistId: "PL1", sort: "default" } as unknown as PlaybackContext;
    await prefetcher.prefetchUpNext(1, "b", playlist, "oldest");
    await settle();
    expect(prepared).toEqual(["b"]);
    expect(lookups).toEqual([]);
  });
});
