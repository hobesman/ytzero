import { log } from "./logger";
import type { PlaybackContext } from "./playbackContext";
import type { PlaybackDirection } from "./playbackAdjacent";

/**
 * Prepares the stream of the videos that will play next, so that YouTube's
 * wait before a new stream address goes live (up to half a minute) passes
 * while the current video plays. A prepared address lasts about six hours.
 */

/** How many videos ahead of the current one are prepared. */
export const UP_NEXT_PREFETCH_COUNT = 3;
const MAX_CONCURRENT_PREFETCHES = 2;
const MAX_QUEUED_PREFETCHES = 24;
/**
 * Clients ask for up next as a video opens. Holding the prefetch back a little
 * lets the video just opened have its own lookup first.
 */
const PREFETCH_DELAY_MS = 10_000;

interface PrefetchDependencies {
  /** Tests shorten it. */
  delayMs?: number;
  /** Whether the video can be streamed from YouTube for this profile and is not already on disk. */
  eligible: (userId: number, videoId: string) => Promise<boolean>;
  ready: (userId: number, videoId: string) => boolean;
  prepare: (userId: number, videoId: string) => Promise<string>;
  nextVideoId: (userId: number, videoId: string, context: PlaybackContext, direction: PlaybackDirection) => Promise<string | null>;
}

export function createDirectStreamPrefetcher(dependencies: PrefetchDependencies) {
  const { eligible, ready, prepare, nextVideoId, delayMs = PREFETCH_DELAY_MS } = dependencies;
  const queue: Array<{ userId: number; videoId: string }> = [];
  const pending = new Set<string>();
  let running = 0;

  function pump(): void {
    while (running < MAX_CONCURRENT_PREFETCHES && queue.length) {
      const { userId, videoId } = queue.shift()!;
      running++;
      void (async () => {
        try {
          if (ready(userId, videoId) || !await eligible(userId, videoId)) return;
          const started = Date.now();
          const result = await prepare(userId, videoId);
          log.info("downloads.direct_stream_prefetched", { userId, videoId, result, ms: Date.now() - started });
        } catch {
          // Prefetching is only a head start; playing the video tries again.
        } finally {
          pending.delete(`${userId}:${videoId}`);
          running--;
          pump();
        }
      })();
    }
  }

  function enqueue(userId: number, videoId: string): void {
    const key = `${userId}:${videoId}`;
    if (pending.has(key) || ready(userId, videoId) || queue.length >= MAX_QUEUED_PREFETCHES) return;
    pending.add(key);
    queue.push({ userId, videoId });
    pump();
  }

  /**
   * Prepares `nextVideoId` (already resolved for the client) and the videos
   * after it in the same order. A channel playlist's order comes from YouTube,
   * so only its first next video is prepared, without asking YouTube again.
   */
  async function prefetchUpNext(userId: number, nextId: string, context: PlaybackContext, direction: PlaybackDirection): Promise<void> {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs).unref?.());
    const seen = new Set<string>();
    let videoId: string | null = nextId;
    for (let index = 0; videoId && !seen.has(videoId) && index < UP_NEXT_PREFETCH_COUNT; index++) {
      seen.add(videoId);
      enqueue(userId, videoId);
      if (context.kind === "channel-playlist") break;
      if (index + 1 < UP_NEXT_PREFETCH_COUNT) videoId = await nextVideoId(userId, videoId, context, direction).catch(() => null);
    }
  }

  return { prefetchUpNext, enqueue };
}
