import { createHmac, timingSafeEqual } from "node:crypto";
import { isPlexId, type PlexAudioStream } from "../plex/plexClient";
import { ALEXA_AUDIO_LINK_TTL_MS } from "./alexaAudioLinks";

/**
 * A movie's or an episode's soundtrack for an Echo, as books are served (see
 * alexaBookAudio.ts): a signed link, so the Echo never sees Plex or its
 * token, starting at the place asked for (`t`, seconds, unsigned), with
 * ffmpeg reading the file from Plex with ranges and writing fragmented MP4.
 *
 * A film's audio is usually 5.1 AC3, E-AC3, DTS or TrueHD, none of which an
 * Echo plays, so it is mixed down to stereo AAC. Stereo AAC is copied as it
 * is. Only the chosen audio track is sent (see chooseAudioStream).
 */

function signature(secret: string, itemId: string, userId: number, expires: number): string {
  return createHmac("sha256", secret).update(`alexa-movie-audio\n${itemId}\n${userId}\n${expires}`).digest("base64url");
}

function posterSignature(secret: string, itemId: string): string {
  return createHmac("sha256", secret).update(`alexa-movie-poster\n${itemId}`).digest("base64url");
}

export function alexaMovieAudioLink(publicUrl: string, secret: string, itemId: string, userId: number, startSeconds = 0, now = Date.now()): string {
  const expires = Math.floor((now + ALEXA_AUDIO_LINK_TTL_MS) / 1000);
  const query = new URLSearchParams({ u: String(userId), e: String(expires), s: signature(secret, itemId, userId, expires) });
  if (startSeconds > 0) query.set("t", String(Math.round(startSeconds * 1000) / 1000));
  return `${publicUrl}/alexa/movie-audio/${itemId}?${query}`;
}

/** The profile a link plays as, or null when it is forged, altered or expired. */
export function verifyAlexaMovieAudioLink(secret: string, itemId: string, query: URLSearchParams, now = Date.now()): number | null {
  if (!isPlexId(itemId)) return null;
  const userId = Number(query.get("u"));
  const expires = Number(query.get("e"));
  const given = Buffer.from(query.get("s") ?? "");
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(expires) || expires * 1000 <= now) return null;
  const expected = Buffer.from(signature(secret, itemId, userId, expires));
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
}

/** A poster for the Echo's screen and the tablet; like book covers, it doesn't expire. */
export function alexaMoviePosterLink(publicUrl: string, secret: string, itemId: string): string {
  return `${publicUrl}/alexa/movie-poster/${itemId}?s=${posterSignature(secret, itemId)}`;
}

export function verifyAlexaMoviePosterLink(secret: string, itemId: string, query: URLSearchParams): boolean {
  if (!isPlexId(itemId)) return false;
  const given = Buffer.from(query.get("s") ?? "");
  const expected = Buffer.from(posterSignature(secret, itemId));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The stream path in a Play directive's URL: the Plex item. */
export const MOVIE_AUDIO_PATH = /\/movie-audio\/(\d{1,12})(?:[?#]|$)/;

const BITRATE = "160k";

/**
 * ffmpeg's arguments for a title's chosen audio track from `startSeconds`.
 * The source's headers carry the Plex token: never log these.
 */
export function movieStreamArgs(source: { url: string; headers: Record<string, string> }, stream: PlexAudioStream | null, startSeconds: number): string[] {
  const headers = Object.entries(source.headers).map(([name, value]) => `${name}: ${value}\r\n`).join("");
  const copy = stream?.codec === "aac" && stream.channels > 0 && stream.channels <= 2;
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-reconnect", "1", "-reconnect_on_network_error", "1", "-reconnect_delay_max", "5",
    ...(headers ? ["-headers", headers] : []),
    ...(startSeconds > 0 ? ["-ss", String(Math.round(startSeconds * 1000) / 1000)] : []),
    "-i", source.url,
    "-map", stream ? `0:${stream.index}` : "0:a:0", "-vn", "-sn", "-dn",
    ...(copy ? ["-c:a", "copy"] : ["-ac", "2", "-c:a", "aac", "-b:a", BITRATE]),
    "-f", "mp4", "-movflags", "empty_moov+default_base_moof", "-frag_duration", "2000000",
    "pipe:1",
  ];
}
