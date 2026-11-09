import type { Context, Hono } from "hono";
import { database } from "../database";
import { isChildUser } from "../childTime";
import { ytdlpStatus } from "../downloadConfig";
import { directVideoStreaming } from "../directVideoStreaming";
import { parseDirectStreamQuality } from "../downloadVideoDirectStreaming";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type VideoState = { live_status: string; members_only: number; is_private: number; is_unavailable: number };

export function registerDirectVideoRoutes(
  api: Hono<ApiEnvironment>,
  currentUserId: (context: Context<ApiEnvironment>) => number,
): void {
  api.get("/videos/:id/direct-hls/:file", async (context) => {
    const userId = currentUserId(context);
    if (await isChildUser(userId)) return context.json({ error: "not allowed" }, 403);
    const videoId = context.req.param("id");
    const file = context.req.param("file");
    if (!["index.m3u8", "video.m3u8", "audio.m3u8", "video.mp4", "audio.mp4"].includes(file)) {
      return context.json({ error: "not found" }, 404);
    }
    const video = await database.prepare(
      "SELECT live_status, members_only, is_private, is_unavailable FROM videos WHERE video_id = ?",
    ).get<VideoState>(videoId);
    if (!video) return context.json({ error: "not found" }, 404);
    if (video.is_private || video.is_unavailable || video.members_only || ["live", "upcoming"].includes(video.live_status)) {
      return context.json({ error: "direct stream unavailable" }, 409);
    }
    // Streaming is independent of the offline-download feature and its
    // experimental play-while-downloading preference.
    if (!await ytdlpStatus()) return context.json({ error: "yt-dlp unavailable" }, 503);
    const signal = context.req.raw.signal;
    const generation = context.req.query("v") ?? null;
    const quality = parseDirectStreamQuality(context.req.query("q"));
    if (file === "video.mp4" || file === "audio.mp4") {
      const result = await directVideoStreaming.getDirectHlsResource(
        userId, videoId, file, context.req.header("range") ?? null, signal, generation, quality,
      );
      if (result.kind === "response") return result.response;
      if (result.kind === "stale") return context.json({ error: "stream changed; reload the playlist" }, 410);
      return context.json({ error: "direct stream unavailable" }, result.kind === "not_found" ? 404 : 502);
    }
    const result = await directVideoStreaming.getDirectHlsPlaylist(
      userId, videoId, file as "index.m3u8" | "video.m3u8" | "audio.m3u8", signal, generation, quality,
    );
    if (result.kind === "playlist") return new Response(result.playlist, {
      headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
    });
    if (result.kind === "stale") return context.json({ error: "stream changed; reload the playlist" }, 410);
    return context.json({ error: "direct stream unavailable" }, result.kind === "unsupported" ? 404 : 502);
  });
}
