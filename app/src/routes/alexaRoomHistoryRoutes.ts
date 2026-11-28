import type { Context, Hono } from "hono";
import type { AlexaSkillKind } from "../alexa/alexaNowPlaying";
import { decodePlaybackToken } from "../alexa/alexaPlayback";
import { roomRecord } from "../alexa/alexaRoomControl";
import { createAlexaRoomHistory, type AlexaRoomHistory } from "../alexa/alexaRoomHistory";
import { normalizeRoomName, type AlexaRoomStore } from "../alexa/alexaRooms";
import type { AlexaRoomSettings } from "../alexa/alexaRoomSettings";
import { musicTracks, type StoredMusicTrack } from "../music/musicCatalog";

type ApiEnvironment = { Variables: { userId: number } };
type ApiContext = Context<ApiEnvironment>;

export interface AlexaRoomHistoryDependencies {
  currentUserId: (context: ApiContext) => number;
  rooms: AlexaRoomStore;
  settings: AlexaRoomSettings;
  history?: AlexaRoomHistory;
  findTracks?: (videoIds: readonly string[]) => Promise<Map<string, StoredMusicTrack>>;
}

/** How many songs of a queue "up next" lists. */
const UPCOMING_LIMIT = 25;
const SKILLS: readonly AlexaSkillKind[] = ["music", "video", "books"];

export interface UpcomingSong { videoId: string; title: string; artist: string; art: string; durationMs: number | null }

/**
 * The room's queue as the tablet shows it: what the room's Echo played lately
 * (this room's, not the profile's whole history), and for music what comes
 * next. A saved queue's remaining songs are known; a station picks each song
 * as the one before ends, so only the song it has already picked is.
 */
export function registerAlexaRoomHistoryRoutes(api: Hono<ApiEnvironment>, dependencies: AlexaRoomHistoryDependencies) {
  const history = dependencies.history ?? createAlexaRoomHistory();
  const findTracks = dependencies.findTracks ?? musicTracks;
  const song = (track: StoredMusicTrack): UpcomingSong => ({
    videoId: track.videoId, title: track.title, artist: track.artist, art: track.thumbnail, durationMs: track.duration ? track.duration * 1000 : null,
  });

  api.get("/alexa/rooms/:room/history", async (context) => {
    const room = normalizeRoomName(context.req.param("room"));
    const skill = context.req.query("skill") as AlexaSkillKind;
    if (!room) return context.json({ error: "invalid room" }, 400);
    if (!SKILLS.includes(skill)) return context.json({ error: "skill must be music, video or books" }, 400);
    return context.json({ room, skill, items: await history.list(dependencies.currentUserId(context), room, skill) });
  });

  api.get("/alexa/rooms/:room/upcoming", async (context) => {
    const room = normalizeRoomName(context.req.param("room"));
    if (!room) return context.json({ error: "invalid room" }, 400);
    const userId = dependencies.currentUserId(context);
    const devices = (await dependencies.rooms.devices(userId)).filter((device) => device.skill === "music");
    const record = roomRecord(devices, room)?.record ?? null;
    const state = record && record.state !== "finished" ? decodePlaybackToken(record.token) : null;
    if (!state) return context.json({ room, playing: false, station: false, songs: [] });
    let ids: string[] = [];
    const queue = state.queue ? await dependencies.settings.queueById(userId, state.queue.id) : null;
    if (queue && !queue.seed && state.queue) ids = queue.videoIds.slice(state.queue.index + 1, state.queue.index + 1 + UPCOMING_LIMIT);
    const queuedNext = decodePlaybackToken(record?.nextToken);
    if (!ids.length && queuedNext && queuedNext.videoId !== state.videoId) ids = [queuedNext.videoId];
    const found = await findTracks(ids);
    const songs = ids.flatMap((id) => { const track = found.get(id); return track ? [song(track)] : []; });
    // Once a saved queue's songs run out, a station like its last one carries on.
    const station = !queue || queue.seed !== null || (state.queue ? state.queue.index + 1 + UPCOMING_LIMIT >= queue.videoIds.length : true);
    return context.json({ room, playing: true, station, songs });
  });
}
