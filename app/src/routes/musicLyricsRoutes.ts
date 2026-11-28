import type { Context, Hono } from "hono";
import type { MusicLyricsService } from "../music/musicLyrics";
import { musicTrack } from "../music/musicCatalog";
import { upstreamFailure } from "../music/musicRouteHelpers";
import { songKey } from "../music/musicSongKey";
import { database } from "../database";
import type { MusicTrackAlbum } from "../music/musicTrackAlbum";

type ApiEnvironment = { Variables: { userId: number } };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The catalogue's track for a song, by its artist|title key: an official upload first, then the closest length. */
async function catalogueTrack(artist: string, title: string, duration: number | null) {
  const row = await database.prepare(`
    SELECT video_id FROM music_tracks WHERE song_key = ?
    ORDER BY is_topic DESC, ABS(COALESCE(duration, 0) - ?) ASC LIMIT 1
  `).get<{ video_id: string }>(songKey(artist, title), duration ?? 0);
  return row ? musicTrack(row.video_id) : null;
}

/**
 * A song's lyrics, for the now-playing screen. Only songs the server has seen
 * are looked up, by their artist, title, album and length. Registered behind
 * the music routes' child-profile guard.
 */
export function registerMusicLyricsRoutes(api: Hono<ApiEnvironment>, { currentUserId, lyrics, albumOf }: {
  currentUserId: (context: Context<ApiEnvironment>) => number; lyrics: MusicLyricsService;
  /** The album a song is on, for the room tablet's now playing; see musicTrackAlbum.ts. */
  albumOf?: MusicTrackAlbum;
}): void {
  api.get("/music/tracks/:id/album", async (context) => {
    const videoId = context.req.param("id");
    if (!VIDEO_ID.test(videoId) || !albumOf) return context.json({ error: "not found" }, 404);
    const track = await musicTrack(videoId);
    if (!track) return context.json({ error: "not found" }, 404);
    return context.json({ browseId: await albumOf(currentUserId(context), track) });
  });

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

  // A song by name, for a room's screen showing what an Echo plays (Amazon
  // Music included): the catalogue's track when there is one, else LRCLIB.
  // Never searches YouTube Music.
  api.get("/music/lyrics", async (context) => {
    const artist = (context.req.query("artist") ?? "").trim().slice(0, 200);
    const title = (context.req.query("title") ?? "").trim().slice(0, 200);
    if (!artist || !title) return context.json({ error: "artist and title are required" }, 400);
    const seconds = Number(context.req.query("duration"));
    const duration = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
    try {
      const track = await catalogueTrack(artist, title, duration);
      return context.json(track ? await lyrics.get(currentUserId(context), track) : await lyrics.bySong({ artist, title, duration }));
    } catch (error) {
      return upstreamFailure(context, error, "music.lyrics_failed");
    }
  });
}
