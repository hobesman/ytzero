import { log } from "./logger";
import { isYouTubeRefusalError } from "./youtubeRateLimit";

export interface ContinuationWalk<Page> {
  /** Names the history in errors, e.g. "channel videos". */
  label: string;
  /** Identifies the walk in log lines, e.g. { channelId, tab }. */
  logFields: Record<string, unknown>;
  firstToken: string | null;
  maxPages: number;
  fetchPage: (token: string) => Promise<Page>;
  collect: (page: Page) => void;
  nextToken: (page: Page) => string | null;
  /** How many items have been collected so far, first page included. */
  collected: () => number;
}

/**
 * Walk a channel tab's continuation pages, newest first, up to `maxPages`.
 * When the walk stops early, the items already collected are kept rather than
 * discarded: the recent uploads that matter are on the early pages, and later
 * syncs pick up anything newer.
 */
export async function walkContinuationPages<Page>(walk: ContinuationWalk<Page>): Promise<void> {
  const requested = new Set<string>();
  let token = walk.firstToken;
  for (let page = 0; token && page < walk.maxPages; page++) {
    if (requested.has(token)) throw new Error(`${walk.label} continuation repeated`);
    requested.add(token);
    let data: Page;
    try {
      data = await walk.fetchPage(token);
    } catch (error) {
      // A rate limit or address refusal must still stop the sync so it backs
      // off from YouTube. Anything else (a timeout, a stray 5xx) only loses
      // the older pages.
      if (isYouTubeRefusalError(error)) throw error;
      log.warn("channel.history_page_failed", {
        ...walk.logFields, page: page + 1, collected: walk.collected(),
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    walk.collect(data);
    token = walk.nextToken(data);
  }
  // More history than the cap allows. The cap still bounds how hard one sync
  // scrapes YouTube.
  if (token) log.warn("channel.history_truncated", { ...walk.logFields, pages: walk.maxPages, collected: walk.collected() });
}
