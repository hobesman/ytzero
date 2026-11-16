import type { Context, Hono } from "hono";
import type { MusicLyricsService } from "../music/musicLyrics";
import { musicTrack } from "../music/musicCatalog";
import { upstreamFailure } from "../music/musicRouteHelpers";

type ApiEnvironment = { Variables: { userId: number } };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * A song's lyrics, for the now-playing screen. Only songs the server has seen
 * are looked up, by their artist, title, album and length. Registered behind
 * the music routes' child-profile guard.
 */
export function registerMusicLyricsRoutes(api: Hono<ApiEnvironment>, { currentUserId, lyrics }: {
  currentUserId: (context: Context<ApiEnvironment>) => number; lyrics: MusicLyricsService;
}): void {
  api.get("/music/tracks/:id/lyrics", async (context) => {
    const videoId = context.req.param("id");
    if (!VIDEO_ID.test(videoId)) return context.json({ error: "not found" }, 404);
    const track = await musicTrack(videoId);
    if (!track) return context.json({ error: "not found" }, 404);
    try {
      return context.json(await lyrics.get(currentUserId(context), track));
    } catch (error) {
      return upstreamFailure(context, error, "music.lyrics_failed");
    }
  });
}
