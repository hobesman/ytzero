import type { Context, Hono } from "hono";
import type { MusicPages } from "../music/musicAlbums";
import { musicTrack, musicTracks, type StoredMusicTrack } from "../music/musicCatalog";
import {
  MAX_PLAYLIST_TRACKS, addPlaylistTrack, addPlaylistTracks, cleanTitle, createPlaylist, deletePlaylist, playlistTrackIds, removePlaylistTrack, renamePlaylist, reorderPlaylist,
  savePlaylist, unsavePlaylist, userPlaylist, userPlaylists,
} from "../music/musicPlaylists";
import { upstreamFailure, withRatings } from "../music/musicRouteHelpers";
import { PLAYLIST_ID } from "../music/youtubeMusicGenreParsers";

type ApiEnvironment = { Variables: { userId: number } };

interface MusicPlaylistRouteDependencies {
  currentUserId: (context: Context<ApiEnvironment>) => number;
  pages: MusicPages;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const notFound = (context: Context) => context.json({ error: "not found" }, 404);

/**
 * A profile's own playlists ("/music/my-playlists"), and saving YouTube Music
 * playlists to the library. Registered behind the music routes' child-profile guard.
 */
export function registerMusicPlaylistRoutes(api: Hono<ApiEnvironment>, { currentUserId, pages }: MusicPlaylistRouteDependencies): void {
  api.get("/music/my-playlists", async (context) => context.json({ playlists: await userPlaylists(currentUserId(context)) }));

  api.post("/music/my-playlists", async (context) => {
    const body = await context.req.json().catch(() => null) as { title?: unknown } | null;
    const title = cleanTitle(body?.title);
    if (!title) return context.json({ error: "title required" }, 400);
    const playlist = await createPlaylist(currentUserId(context), title);
    return playlist ? context.json({ playlist }, 201) : context.json({ error: "too many playlists" }, 409);
  });

  // The playlist and its songs. A song whose details the server no longer has is left out until it is seen again.
  api.get("/music/my-playlists/:id", async (context) => {
    const userId = currentUserId(context);
    const playlist = await userPlaylist(userId, context.req.param("id"));
    if (!playlist) return notFound(context);
    const ids = await playlistTrackIds(playlist.id);
    const known = await musicTracks(ids);
    const tracks = ids.map((videoId) => known.get(videoId)).filter((track): track is StoredMusicTrack => Boolean(track));
    return context.json({ ...playlist, tracks: await withRatings(userId, tracks) });
  });

  api.patch("/music/my-playlists/:id", async (context) => {
    const body = await context.req.json().catch(() => null) as { title?: unknown } | null;
    const title = cleanTitle(body?.title);
    if (!title) return context.json({ error: "title required" }, 400);
    return await renamePlaylist(currentUserId(context), context.req.param("id"), title) ? context.json({ ok: true, title }) : notFound(context);
  });

  api.delete("/music/my-playlists/:id", async (context) =>
    await deletePlaylist(currentUserId(context), context.req.param("id")) ? context.json({ ok: true }) : notFound(context));

  // One song (`videoId`), or several in order (`videoIds`: an album or another playlist).
  api.post("/music/my-playlists/:id/tracks", async (context) => {
    const body = await context.req.json().catch(() => null) as { videoId?: unknown; videoIds?: unknown } | null;
    if (body?.videoIds !== undefined) {
      const videoIds = body.videoIds;
      if (!Array.isArray(videoIds) || !videoIds.length || videoIds.length > MAX_PLAYLIST_TRACKS
        || !videoIds.every((videoId) => typeof videoId === "string" && VIDEO_ID.test(videoId))) return context.json({ error: "invalid songs" }, 400);
      // As with one song, only songs the server has seen can be added; the rest are counted as unknown.
      const unique = [...new Set(videoIds as string[])];
      const known = await musicTracks(unique);
      const songs = unique.filter((videoId) => known.has(videoId));
      const result = await addPlaylistTracks(currentUserId(context), context.req.param("id"), songs);
      if (result === "missing") return notFound(context);
      return context.json({ ok: true, ...result, unknown: unique.length - songs.length });
    }
    const videoId = body?.videoId;
    if (typeof videoId !== "string" || !VIDEO_ID.test(videoId)) return context.json({ error: "invalid song" }, 400);
    // Only songs the server has seen can be added, so the playlist can show them.
    if (!await musicTrack(videoId)) return notFound(context);
    const result = await addPlaylistTrack(currentUserId(context), context.req.param("id"), videoId);
    if (result === "missing") return notFound(context);
    if (result === "full") return context.json({ error: "playlist is full" }, 409);
    return context.json({ ok: true, added: result === "added" });
  });

  api.delete("/music/my-playlists/:id/tracks/:videoId", async (context) => {
    const videoId = context.req.param("videoId");
    if (!VIDEO_ID.test(videoId)) return notFound(context);
    return await removePlaylistTrack(currentUserId(context), context.req.param("id"), videoId) ? context.json({ ok: true }) : notFound(context);
  });

  api.put("/music/my-playlists/:id/order", async (context) => {
    const body = await context.req.json().catch(() => null) as { videoIds?: unknown } | null;
    const order = Array.isArray(body?.videoIds) ? body.videoIds : null;
    if (!order || !order.every((videoId) => typeof videoId === "string" && VIDEO_ID.test(videoId))) return context.json({ error: "invalid order" }, 400);
    const result = await reorderPlaylist(currentUserId(context), context.req.param("id"), order as string[]);
    if (result === "missing") return notFound(context);
    if (result === "mismatch") return context.json({ error: "the playlist changed; reload it" }, 409);
    return context.json({ ok: true });
  });

  // Saving keeps the playlist's details as YouTube Music shows them now.
  api.put("/music/playlists/:id/saved", async (context) => {
    const userId = currentUserId(context);
    const playlistId = context.req.param("id");
    if (!PLAYLIST_ID.test(playlistId)) return notFound(context);
    try {
      const page = await pages.playlist(userId, playlistId);
      if (!page) return notFound(context);
      const { tracks: _tracks, ...playlist } = page;
      await savePlaylist(userId, playlist);
      return context.json({ ok: true, saved: true });
    } catch (error) {
      return upstreamFailure(context, error, "music.playlist_save_failed");
    }
  });

  api.delete("/music/playlists/:id/saved", async (context) => {
    const playlistId = context.req.param("id");
    if (!PLAYLIST_ID.test(playlistId)) return notFound(context);
    await unsavePlaylist(currentUserId(context), playlistId);
    return context.json({ ok: true, saved: false });
  });
}
