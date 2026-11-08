import type { DirectVideoPlaylistResult } from "./downloadVideoDirectStreaming";

/**
 * The HLS presentation needs YouTube's separate video and audio streams. When
 * those cannot be read (YouTube refusing them, for example), the single
 * progressive stream often still plays, so a native client is offered that
 * instead of a playlist that will fail.
 */
export function nativeKindForDirectPlaylist(result: DirectVideoPlaylistResult["kind"]): "direct-hls" | "direct" {
  return result === "playlist" || result === "stale" ? "direct-hls" : "direct";
}
