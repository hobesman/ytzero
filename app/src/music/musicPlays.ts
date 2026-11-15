import { database } from "../database";

export type MusicPlayEndReason = "completed" | "skipped" | "stopped";

export interface MusicPlay {
  videoId: string;
  startedAt: Date;
  listenedSeconds: number;
  duration: number | null;
  endReason: MusicPlayEndReason;
  stationSeed: string | null;
}

/** One listen, keyed by when it started, so a later report of the same listen updates it. */
export async function recordMusicPlay(userId: number, play: MusicPlay): Promise<void> {
  await database.prepare(`
    INSERT INTO music_plays (user_id, video_id, started_at, listened_seconds, duration, end_reason, station_seed)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, video_id, started_at) DO UPDATE SET
      listened_seconds = excluded.listened_seconds, duration = excluded.duration, end_reason = excluded.end_reason
  `).run(userId, play.videoId, play.startedAt.toISOString(), play.listenedSeconds, play.duration, play.endReason, play.stationSeed?.slice(0, 40) ?? null);
}
