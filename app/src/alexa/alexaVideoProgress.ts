import { database } from "../database";
import type { AsyncDatabaseClient } from "../databaseClient";
import { log } from "../logger";
import { nowPlayingPosition, type NowPlayingState } from "./alexaNowPlaying";
import { recordVideoProgress } from "./alexaVideoCatalog";

/** How often a playing video's estimated position is saved. */
export const ALEXA_VIDEO_PROGRESS_INTERVAL_MS = 30_000;

interface PlayingRow {
  user_id: number; video_id: string; state: NowPlayingState; offset_ms: number; started_at: string | null; duration_ms: number | null;
}

/**
 * Alexa reports a position only when something happens (a start, pause or
 * stop), never while a video plays. So that Continue watching moves, and a
 * resume works even when no stop arrives, this saves each playing Hoban Tube
 * video's estimated position: the time since the Echo reported it started.
 * The next stop replaces it with the position Alexa reports.
 */
export async function saveAlexaVideoProgress(
  now: number,
  db: AsyncDatabaseClient = database,
  record: typeof recordVideoProgress = recordVideoProgress,
): Promise<number> {
  const rows = await db.prepare(`SELECT user_id, video_id, state, offset_ms, started_at, duration_ms FROM alexa_now_playing
    WHERE skill = 'video' AND state = 'playing' AND started_at IS NOT NULL`).all<PlayingRow>();
  let saved = 0;
  for (const row of rows) {
    const durationMs = row.duration_ms == null ? null : Number(row.duration_ms);
    // Past its end, the Echo stopped without saying so; leave the last saved place.
    if (durationMs && now - Date.parse(row.started_at!) > durationMs) continue;
    const position = nowPlayingPosition({ state: row.state, offsetMs: Number(row.offset_ms), startedAt: row.started_at, durationMs }, now);
    await record(Number(row.user_id), row.video_id, Math.floor(position / 1000), durationMs ? Math.round(durationMs / 1000) : null);
    saved += 1;
  }
  return saved;
}

/** Starts saving playing videos' positions in the background; returns a function that stops it. */
export function startAlexaVideoProgress(interval = ALEXA_VIDEO_PROGRESS_INTERVAL_MS): () => void {
  const timer = setInterval(() => {
    saveAlexaVideoProgress(Date.now()).catch((error) => {
      log.warn("alexa.video_progress_failed", { error: error instanceof Error ? error.message : String(error) });
    });
  }, interval);
  timer.unref?.();
  return () => clearInterval(timer);
}
