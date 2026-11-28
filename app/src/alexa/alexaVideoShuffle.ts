import type { AlexaVideo } from "./alexaVideoCatalog";
import { withoutStreamStart } from "./alexaStreamTokens";

/**
 * Shuffled videos from one channel. Like a music station, the state travels in
 * the stream token Alexa hands back with every event: the channel, the video
 * playing and the ones already played, so nothing is kept on the server.
 */
export interface VideoShuffle {
  channelId: string;
  videoId: string;
  played: string[];
}

const PREFIX = "yvs.";
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^[A-Za-z0-9_-]{2,40}$/;
/** Alexa caps a token at 1024 characters; 60 played IDs keep it well under. */
export const SHUFFLE_PLAYED_LIMIT = 60;

export function encodeShuffleToken(state: VideoShuffle): string {
  return `${PREFIX}${state.channelId}.${state.videoId}.${state.played.slice(-SHUFFLE_PLAYED_LIMIT).join(",")}`;
}

export function decodeShuffleToken(given: unknown): VideoShuffle | null {
  const token = typeof given === "string" ? withoutStreamStart(given) : given;
  if (typeof token !== "string" || !token.startsWith(PREFIX)) return null;
  const [channelId, videoId, played = "", ...extra] = token.slice(PREFIX.length).split(".");
  if (extra.length || !CHANNEL_ID.test(channelId ?? "") || !VIDEO_ID.test(videoId ?? "")) return null;
  const ids = played ? played.split(",") : [];
  if (!ids.every((id) => VIDEO_ID.test(id))) return null;
  return { channelId, videoId, played: ids };
}

/** The state after `state`, moving on to `next`. */
export function shuffleAfter(state: VideoShuffle, next: string): VideoShuffle {
  return { channelId: state.channelId, videoId: next, played: [...state.played, state.videoId].slice(-SHUFFLE_PLAYED_LIMIT) };
}

/**
 * A random video from a channel's uploads: never a Short, a live stream or
 * one already played in this shuffle, and one the profile hasn't watched when
 * there is any. Once every video has played, it starts over.
 */
export function pickRandomVideo(videos: readonly AlexaVideo[], played: readonly string[], random = Math.random): AlexaVideo | null {
  const candidates = videos.filter((video) => video.playable && !video.isShort);
  const fresh = candidates.filter((video) => !played.includes(video.videoId));
  const pool = fresh.length ? fresh : candidates.filter((video) => video.videoId !== played[played.length - 1]);
  const unwatched = pool.filter((video) => !video.watched);
  const from = unwatched.length ? unwatched : pool;
  return from.length ? from[Math.floor(random() * from.length)] : null;
}
