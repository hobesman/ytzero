import type { Context, Hono } from "hono";
import type { MusicPages } from "../music/musicAlbums";
import { upstreamFailure, withRatings } from "../music/musicRouteHelpers";
import { isAlbumSaved, saveAlbum, unsaveAlbum } from "../music/musicSavedAlbums";
import { ALBUM_ID, ARTIST_ID } from "../music/youtubeMusicBrowseParsers";

type ApiEnvironment = { Variables: { userId: number } };

interface MusicAlbumRouteDependencies {
  currentUserId: (context: Context<ApiEnvironment>) => number;
  pages: MusicPages;
}

/** Album and artist pages, and saved albums. Registered behind the music routes' child-profile guard. */
export function registerMusicAlbumRoutes(api: Hono<ApiEnvironment>, { currentUserId, pages }: MusicAlbumRouteDependencies): void {
  api.get("/music/albums/:id", async (context) => {
    const userId = currentUserId(context);
    const browseId = context.req.param("id");
    if (!ALBUM_ID.test(browseId)) return context.json({ error: "not found" }, 404);
    try {
      const page = await pages.album(userId, browseId);
      if (!page) return context.json({ error: "not found" }, 404);
      return context.json({ ...page, tracks: await withRatings(userId, page.tracks), saved: await isAlbumSaved(userId, browseId) });
    } catch (error) {
      return upstreamFailure(context, error, "music.album_failed");
    }
  });

  api.get("/music/artists/:id", async (context) => {
    const userId = currentUserId(context);
    const channelId = context.req.param("id");
    if (!ARTIST_ID.test(channelId)) return context.json({ error: "not found" }, 404);
    try {
      const page = await pages.artist(userId, channelId);
      if (!page) return context.json({ error: "not found" }, 404);
      return context.json({ ...page, topSongs: await withRatings(userId, page.topSongs) });
    } catch (error) {
      return upstreamFailure(context, error, "music.artist_failed");
    }
  });

  // Saving keeps the album's details as YouTube Music shows them now.
  api.put("/music/albums/:id/saved", async (context) => {
    const userId = currentUserId(context);
    const browseId = context.req.param("id");
    if (!ALBUM_ID.test(browseId)) return context.json({ error: "not found" }, 404);
    try {
      const page = await pages.album(userId, browseId);
      if (!page) return context.json({ error: "not found" }, 404);
      const { tracks: _tracks, ...album } = page;
      await saveAlbum(userId, album);
      return context.json({ ok: true, saved: true });
    } catch (error) {
      return upstreamFailure(context, error, "music.album_save_failed");
    }
  });

  api.delete("/music/albums/:id/saved", async (context) => {
    const browseId = context.req.param("id");
    if (!ALBUM_ID.test(browseId)) return context.json({ error: "not found" }, 404);
    await unsaveAlbum(currentUserId(context), browseId);
    return context.json({ ok: true, saved: false });
  });
}
