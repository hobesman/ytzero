import { createDownloadVideoProgressiveStreaming } from "./downloadVideoProgressiveStreaming";
import { YTDLP, downloadCookiesFile, ytdlpStatus } from "./downloadConfig";

/**
 * The fast-start bridge: a 360p stream that plays at once while the chosen
 * quality gets ready.
 *
 * YouTube's default client (TVHTML5) refuses a new address for up to half a
 * minute. Its android_vr client returns one that plays immediately, but
 * serves only about the first minute of the video. Measured on the live
 * server, 2026-11-22: a 3 s lookup, live at once for 9 videos in 10, and
 * 61–68 s of video served before every later range is refused. That is enough
 * to cover the wait from the start of a video, and no more, so the app swaps
 * to the full stream as soon as it is ready.
 *
 * android_vr does not accept cookies, so this always looks the video up
 * anonymously. A refused range is answered at once rather than looked up
 * again: past the first minute a new address would be refused just the same.
 */
export const bridgeVideoStreaming = createDownloadVideoProgressiveStreaming({
  YTDLP,
  downloadCookiesConfigured: () => false,
  downloadCookiesFile,
  ytdlpStatus,
  dlSettings: async () => ({ quality: "360" }),
  extraArgs: ["--extractor-args", "youtube:player_client=android_vr"],
  refreshOnRefusal: false,
});

/** Fast start uses the bridge only from about the start; it serves the first minute or so. */
export const BRIDGE_MAX_START_SECONDS = 30;
