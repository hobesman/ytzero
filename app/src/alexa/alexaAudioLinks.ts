import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Alexa fetches audio from Amazon's cloud with no cookie, so each link carries
 * its own signature. Links are stateless, so they survive a restart, and they
 * last long enough to resume a song or video paused overnight.
 */
export const ALEXA_AUDIO_LINK_TTL_MS = 24 * 60 * 60_000;

/** A music-mode song, or the audio of an ordinary video; a link for one never opens the other. */
export type AlexaAudioKind = "music" | "video";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PATHS: Record<AlexaAudioKind, string> = { music: "audio", video: "video-audio" };

function signature(secret: string, kind: AlexaAudioKind, videoId: string, userId: number, expires: number): string {
  const label = kind === "music" ? "alexa-audio" : "alexa-video-audio";
  return createHmac("sha256", secret).update(`${label}\n${videoId}\n${userId}\n${expires}`).digest("base64url");
}

export function alexaAudioLink(publicUrl: string, secret: string, videoId: string, userId: number, now = Date.now(), kind: AlexaAudioKind = "music"): string {
  const expires = Math.floor((now + ALEXA_AUDIO_LINK_TTL_MS) / 1000);
  const query = new URLSearchParams({ u: String(userId), e: String(expires), s: signature(secret, kind, videoId, userId, expires) });
  return `${publicUrl}/alexa/${PATHS[kind]}/${videoId}?${query}`;
}

/** The profile a link plays as, or null when it is forged, altered, expired or for the other kind. */
export function verifyAlexaAudioLink(secret: string, videoId: string, query: URLSearchParams, now = Date.now(), kind: AlexaAudioKind = "music"): number | null {
  if (!VIDEO_ID.test(videoId)) return null;
  const userId = Number(query.get("u"));
  const expires = Number(query.get("e"));
  const given = Buffer.from(query.get("s") ?? "");
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(expires) || expires * 1000 <= now) return null;
  const expected = Buffer.from(signature(secret, kind, videoId, userId, expires));
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
}

/**
 * A video's audio as an HLS playlist, which every Hoban Tube play uses: the
 * Echo fetches it a small segment at a time, and a playlist can start part way
 * in (`t`, seconds; see alexaPlaylistTrim.ts), which the Echo can't do in the
 * plain file. Signed like the file, which its segments point at; `t` is left
 * out of the signature, since any start within the video is allowed.
 */
export function alexaPlaylistLink(publicUrl: string, secret: string, videoId: string, userId: number, now = Date.now(), startSeconds = 0): string {
  const link = alexaAudioLink(publicUrl, secret, videoId, userId, now, "video").replace("?", "/index.m3u8?");
  return startSeconds > 0 ? `${link}&t=${Math.round(startSeconds * 1000) / 1000}` : link;
}

/** The app's playlist over its own audio route, pointed at the signed Alexa file link instead. */
export function alexaPlaylist(playlist: string, videoId: string, fileLink: string): string {
  return playlist.split(`/api/videos/${encodeURIComponent(videoId)}/audio`).join(fileLink);
}
