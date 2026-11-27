import { database } from "./database";
import { claimTubeArchivistWatchedState, enqueueTubeArchivistWatched } from "./tubeArchivist";

export async function completeVideo(userId: number, videoId: string): Promise<void> {
  await database.transaction(async () => {
    const previous = await database.prepare("SELECT watched FROM user_videos WHERE user_id=? AND video_id=?")
      .get(userId, videoId) as { watched: number | null } | null;
    // A video marked watched part-way through counts as watched to the end, so
    // it leaves Continue watching (which lists partial progress) and a later
    // play starts again from the beginning.
    await database.prepare(
      `INSERT INTO user_videos (user_id, video_id, watched) VALUES (?, ?, 1)
       ON CONFLICT(user_id, video_id) DO UPDATE SET watched = 1, playback_context_json = NULL,
         watch_position = COALESCE(user_videos.watch_duration, user_videos.watch_position)`
    ).run(userId, videoId);
    await database.prepare("INSERT INTO history (video_id, user_id) VALUES (?, ?)").run(videoId, userId);
    await claimTubeArchivistWatchedState(userId, videoId);
    // Reasserting an already-watched value would unnecessarily move
    // TubeArchivist's watched_date and can interfere with its retention rules.
    if (previous?.watched !== 1) await enqueueTubeArchivistWatched(videoId, true);
  })();
}

/** Seconds into a watched video at which playing it again counts as watching it again. */
export const REWATCH_AFTER_SECONDS = 30;
/** Continue watching lists a video until it is this far through, as the feed does. */
const CONTINUE_WATCHING_LIMIT = 0.92;

/**
 * Where playback is, from the app's player or an Echo. A watched video played
 * again past its first seconds isn't watched any more, so it shows in
 * Continue watching and resumes like any other; playing it to the end marks
 * it watched again. Its history is kept.
 */
export async function saveWatchProgress(userId: number, videoId: string, position: number, duration: number | null): Promise<void> {
  await database.transaction(async () => {
    await database.prepare(
      `INSERT INTO user_videos (user_id, video_id, watch_position, watch_duration) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, video_id) DO UPDATE SET watch_position = excluded.watch_position,
         watch_duration = COALESCE(excluded.watch_duration, user_videos.watch_duration)`
    ).run(userId, videoId, position, duration);
    const state = await database.prepare("SELECT watched, watch_duration FROM user_videos WHERE user_id=? AND video_id=?")
      .get(userId, videoId) as { watched: number | null; watch_duration: number | null } | null;
    const length = Number(state?.watch_duration) || 0;
    if (state?.watched !== 1 || position < REWATCH_AFTER_SECONDS || !length || position / length >= CONTINUE_WATCHING_LIMIT) return;
    await database.prepare("UPDATE user_videos SET watched = NULL WHERE user_id=? AND video_id=?").run(userId, videoId);
    await claimTubeArchivistWatchedState(userId, videoId);
    await enqueueTubeArchivistWatched(videoId, false);
  })();
}
