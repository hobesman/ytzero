import type { Context } from "hono";
import { database } from "../database";
import { log } from "../logger";
import { isYouTubeRefusalError } from "../youtubeRateLimit";
import type { StoredMusicTrack } from "./musicCatalog";

/** Tracks as the music routes return them: without the internal song key, with the profile's rating. */
export async function withRatings(userId: number, tracks: readonly StoredMusicTrack[]) {
  if (!tracks.length) return [];
  const ids = [...new Set(tracks.map((track) => track.videoId))];
  const rows = await database.prepare(`SELECT video_id, rating FROM music_ratings WHERE user_id = ? AND video_id IN (${ids.map(() => "?").join(",")})`)
    .all<{ video_id: string; rating: number }>(userId, ...ids);
  const ratings = new Map(rows.map((row) => [row.video_id, Number(row.rating)]));
  return tracks.map(({ songKey: _songKey, ...track }) => ({ ...track, rating: ratings.get(track.videoId) ?? 0 }));
}

export function upstreamFailure(context: Context, error: unknown, event: string) {
  if (isYouTubeRefusalError(error)) return context.json({ error: "YouTube is refusing requests right now", code: "youtube_refused" }, 503);
  log.warn(event, { error: error instanceof Error ? error.message : String(error) });
  return context.json({ error: "YouTube Music is unavailable" }, 502);
}
