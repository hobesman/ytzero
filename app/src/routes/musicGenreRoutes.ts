import type { Context, Hono } from "hono";
import type { MusicPages } from "../music/musicAlbums";
import { isPlaylistSaved } from "../music/musicPlaylists";
import { upstreamFailure, withRatings } from "../music/musicRouteHelpers";
import { GENRE_ID, PLAYLIST_ID } from "../music/youtubeMusicGenreParsers";

type ApiEnvironment = { Variables: { userId: number } };

interface MusicGenreRouteDependencies {
  currentUserId: (context: Context<ApiEnvironment>) => number;
  pages: MusicPages;
}

/** YouTube Music's Moods & genres, and playlist pages. Registered behind the music routes' child-profile guard. */
export function registerMusicGenreRoutes(api: Hono<ApiEnvironment>, { currentUserId, pages }: MusicGenreRouteDependencies): void {
  api.get("/music/genres", async (context) => {
    try {
      return context.json({ genres: await pages.genres(currentUserId(context)) });
    } catch (error) {
      return upstreamFailure(context, error, "music.genres_failed");
    }
  });

  api.get("/music/genres/:id", async (context) => {
    const id = context.req.param("id");
    if (!GENRE_ID.test(id)) return context.json({ error: "not found" }, 404);
    try {
      const page = await pages.genre(currentUserId(context), id);
      return page ? context.json(page) : context.json({ error: "not found" }, 404);
    } catch (error) {
      return upstreamFailure(context, error, "music.genre_failed");
    }
  });

  api.get("/music/playlists/:id", async (context) => {
    const userId = currentUserId(context);
    const playlistId = context.req.param("id");
    if (!PLAYLIST_ID.test(playlistId)) return context.json({ error: "not found" }, 404);
    try {
      const page = await pages.playlist(userId, playlistId);
      if (!page) return context.json({ error: "not found" }, 404);
      return context.json({ ...page, tracks: await withRatings(userId, page.tracks), saved: await isPlaylistSaved(userId, playlistId) });
    } catch (error) {
      return upstreamFailure(context, error, "music.playlist_failed");
    }
  });
}
