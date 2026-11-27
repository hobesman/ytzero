import { database } from "../database";
import { completeVideo } from "../videoCompletion";
import { durationSeconds } from "./alexaVideoMatch";

export interface AlexaChannel {
  channelId: string;
  title: string;
}

export interface AlexaVideo {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  thumbnail: string;
  /** Whole seconds, when known. */
  duration: number | null;
  /** Where the profile left off, when it stopped part-way through. */
  resumeAt: number | null;
  /** Audio can't be served for live, upcoming, private, unavailable or members-only videos. */
  playable: boolean;
  isShort: boolean;
  /** Whether the profile has watched it to the end. */
  watched?: boolean;
}

type VideoRow = {
  video_id: string; title: string; channel_id: string; channel_title: string; thumbnail: string; duration: string | null;
  live_status: string; is_private: number | null; is_unavailable: number | null; members_only: number | null; is_short: number | null;
  watch_position: number | null; watched: number | null;
};

const VIDEO_COLUMNS = `
  v.video_id, v.title, v.channel_id, COALESCE(NULLIF(c.custom_title, ''), c.title) AS channel_title, v.thumbnail, v.duration,
  v.live_status, v.is_private, v.is_unavailable, v.members_only, v.is_short, uv.watch_position, uv.watched`;

// Enough of a channel's uploads to find an older video by name, few enough to score quickly.
const CHANNEL_VIDEO_LIMIT = 500;
// Within this much of either end, a video starts from the beginning.
const RESUME_MARGIN_SECONDS = 30;

function toVideo(row: VideoRow): AlexaVideo {
  const duration = durationSeconds(row.duration);
  const position = Number(row.watch_position) || 0;
  const resumable = row.watched !== 1 && position > RESUME_MARGIN_SECONDS && (duration === null || position < duration - RESUME_MARGIN_SECONDS);
  return {
    videoId: row.video_id,
    title: row.title,
    channelId: row.channel_id,
    channelTitle: row.channel_title,
    thumbnail: row.thumbnail,
    duration,
    resumeAt: resumable ? Math.floor(position) : null,
    playable: row.is_private !== 1 && row.is_unavailable !== 1 && row.members_only !== 1 && !["live", "upcoming"].includes(row.live_status),
    isShort: row.is_short === 1,
    watched: row.watched === 1,
  };
}

export async function followedChannels(userId: number): Promise<AlexaChannel[]> {
  const rows = await database.prepare(`
    SELECT c.channel_id, COALESCE(NULLIF(c.custom_title, ''), c.title) AS title
    FROM user_channels uc JOIN channels c ON c.channel_id = uc.channel_id
    WHERE uc.user_id = ? AND uc.followed = 1
  `).all<{ channel_id: string; title: string }>(userId);
  return rows.filter((row) => row.title).map((row) => ({ channelId: row.channel_id, title: row.title }));
}

/** The channel's videos, newest first. */
export async function channelVideos(userId: number, channelId: string): Promise<AlexaVideo[]> {
  const rows = await database.prepare(`
    SELECT ${VIDEO_COLUMNS}
    FROM videos v JOIN channels c ON c.channel_id = v.channel_id
    LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ?
    WHERE v.channel_id = ?
    ORDER BY v.published_at DESC LIMIT ${CHANNEL_VIDEO_LIMIT}
  `).all<VideoRow>(userId, channelId);
  return rows.map(toVideo);
}

export async function alexaVideo(userId: number, videoId: string): Promise<AlexaVideo | null> {
  const row = await database.prepare(`
    SELECT ${VIDEO_COLUMNS}
    FROM videos v JOIN channels c ON c.channel_id = v.channel_id
    LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ?
    WHERE v.video_id = ?
  `).get<VideoRow>(userId, videoId);
  return row ? toVideo(row) : null;
}

/** The video the profile most recently started and left part-way through, if any. */
export async function lastUnfinishedVideo(userId: number): Promise<string | null> {
  const row = await database.prepare(`
    SELECT h.video_id FROM history h
    JOIN user_videos uv ON uv.user_id = h.user_id AND uv.video_id = h.video_id
    WHERE h.user_id = ? AND COALESCE(uv.watched, 0) <> 1 AND uv.watch_position > ?
    ORDER BY h.id DESC LIMIT 1
  `).get<{ video_id: string }>(userId, RESUME_MARGIN_SECONDS);
  return row?.video_id ?? null;
}

/** As the app's player does: a history entry when a video starts. */
export async function recordVideoStarted(userId: number, videoId: string): Promise<void> {
  await database.prepare("INSERT INTO history (video_id, user_id) VALUES (?, ?)").run(videoId, userId);
}

/** Where listening stopped, so the app's Continue watching picks it up. */
export async function recordVideoProgress(userId: number, videoId: string, position: number, duration: number | null): Promise<void> {
  await database.prepare(`
    INSERT INTO user_videos (user_id, video_id, watch_position, watch_duration) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, video_id) DO UPDATE SET watch_position = excluded.watch_position,
      watch_duration = COALESCE(excluded.watch_duration, user_videos.watch_duration)
  `).run(userId, videoId, position, duration);
}

export async function recordVideoFinished(userId: number, videoId: string): Promise<void> {
  await completeVideo(userId, videoId);
}
