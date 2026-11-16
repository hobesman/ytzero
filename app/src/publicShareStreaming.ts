import { ytdlpStatus } from "./downloadConfig";
import { directVideoStreaming } from "./directVideoStreaming";
import { parseDirectStreamQuality } from "./downloadVideoDirectStreaming";

// Opt-in server streaming for public share links. It reuses the signed-in
// direct HLS player path: yt-dlp resolves the video with the share owner's
// YouTube session, and this server relays the byte ranges. Only the owner's
// explicit per-link grant reaches this module.

export const PUBLIC_SHARE_STREAM_FILES = ["index.m3u8", "video.m3u8", "audio.m3u8", "video.mp4", "audio.mp4"] as const;
export type PublicShareStreamFile = (typeof PUBLIC_SHARE_STREAM_FILES)[number];

export interface PublicShareStreamingBackend {
  available: () => Promise<boolean>;
  playlist: typeof directVideoStreaming.getDirectHlsPlaylist;
  resource: typeof directVideoStreaming.getDirectHlsResource;
}

export const defaultPublicShareStreamingBackend: PublicShareStreamingBackend = {
  available: async () => Boolean(await ytdlpStatus()),
  playlist: (...args) => directVideoStreaming.getDirectHlsPlaylist(...args),
  resource: (...args) => directVideoStreaming.getDirectHlsResource(...args),
};

export function isPublicShareStreamFile(value: string): value is PublicShareStreamFile {
  return (PUBLIC_SHARE_STREAM_FILES as readonly string[]).includes(value);
}

export function publicShareStreamUrl(token: string, videoId: string): string {
  return `${publicShareStreamBase(token, videoId)}/index.m3u8`;
}

function publicShareStreamBase(token: string, videoId: string): string {
  return `/share/${encodeURIComponent(token)}/stream/${encodeURIComponent(videoId)}`;
}

/** The shared presentation points at the signed-in `/api/videos/.../direct-hls`
 * routes. Anonymous visitors must stay under `/share/<token>/`. */
export function rewritePublicSharePlaylist(playlist: string, token: string, videoId: string): string {
  return playlist.split(`/api/videos/${encodeURIComponent(videoId)}/direct-hls`).join(publicShareStreamBase(token, videoId));
}

export function publicShareVideoStreamable(video: { live_status: string }): boolean {
  return !["live", "upcoming"].includes(video.live_status);
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export async function publicShareStreamResponse(backend: PublicShareStreamingBackend, input: {
  ownerUserId: number;
  token: string;
  videoId: string;
  file: PublicShareStreamFile;
  range: string | null;
  generation: string | null;
  quality: string | undefined;
  signal: AbortSignal;
}): Promise<Response> {
  if (!await backend.available()) return jsonError("stream unavailable", 503);
  const quality = parseDirectStreamQuality(input.quality);
  if (input.file === "video.mp4" || input.file === "audio.mp4") {
    const result = await backend.resource(input.ownerUserId, input.videoId, input.file, input.range, input.signal, input.generation, quality);
    if (result.kind === "response") return result.response;
    if (result.kind === "stale") return jsonError("stream changed; reload the playlist", 410);
    return jsonError("stream unavailable", result.kind === "not_found" ? 404 : 502);
  }
  const result = await backend.playlist(input.ownerUserId, input.videoId, input.file, input.signal, input.generation, quality);
  if (result.kind === "playlist") return new Response(rewritePublicSharePlaylist(result.playlist, input.token, input.videoId), {
    headers: { "Content-Type": "application/vnd.apple.mpegurl" },
  });
  if (result.kind === "stale") return jsonError("stream changed; reload the playlist", 410);
  return jsonError("stream unavailable", result.kind === "unsupported" ? 404 : 502);
}
