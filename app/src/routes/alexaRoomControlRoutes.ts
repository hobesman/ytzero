import type { Context, Hono } from "hono";
import { alexaConfig } from "../alexa/alexaConfig";
import type { AlexaSkillKind } from "../alexa/alexaNowPlaying";
import {
  controlRoom, pairRoom, parseRoomAction, playRoomQueue, RoomControlError, roomSpelling, type RoomControlDependencies,
} from "../alexa/alexaRoomControl";
import { normalizeRoomName, type AlexaRoomStore } from "../alexa/alexaRooms";
import { cleanVideoIds, type AlexaRoomQueue, type AlexaRoomSettings } from "../alexa/alexaRoomSettings";
import { parseRoomVideoRequest, playRoomVideo, type RoomVideoLookup } from "../alexa/alexaRoomVideo";
import { alexaVideo, followedChannels } from "../alexa/alexaVideoCatalog";
import {
  alexaInvocations, createHomeAssistantClient, homeAssistantConfig, homeAssistantReport, HomeAssistantError, isAlexaMediaPlayer,
  isMediaPlayerEntity, type AlexaInvocations, type HomeAssistantClient, type HomeAssistantReport,
} from "../alexa/homeAssistant";
import { musicTracks } from "../music/musicCatalog";
import { parseStationSeed } from "../music/musicStation";

type ApiEnvironment = { Variables: { userId: number } };
type ApiContext = Context<ApiEnvironment>;

export interface AlexaRoomControlDependencies {
  currentUserId: (context: ApiContext) => number;
  rooms: AlexaRoomStore;
  settings: AlexaRoomSettings;
  /** The Home Assistant client, or why there is none. */
  homeAssistant?: () => HomeAssistantClient | { disabled: string };
  invocations?: () => AlexaInvocations;
  skills?: () => Record<AlexaSkillKind, boolean>;
  /** Which of these songs the music catalog has, so the skill can play them. */
  knownSongs?: (videoIds: readonly string[]) => Promise<Set<string>>;
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
  pairWaitMs?: number;
  /** The profile's videos and followed channels, for starting a video from a screen. */
  videoLookup?: (userId: number) => RoomVideoLookup;
}

let defaultClient: { key: string; client: HomeAssistantClient } | null = null;
function defaultHomeAssistant(): HomeAssistantClient | { disabled: string } {
  const config = homeAssistantConfig();
  if ("disabled" in config) return config;
  const key = `${config.url}\n${config.token}`;
  if (defaultClient?.key !== key) defaultClient = { key, client: createHomeAssistantClient(config) };
  return defaultClient.client;
}

function defaultSkills(): Record<AlexaSkillKind, boolean> {
  const config = alexaConfig();
  return "disabled" in config ? { music: false, video: false } : { music: Boolean(config.musicSkillId), video: Boolean(config.videoSkillId) };
}

const defaultVideoLookup = (userId: number): RoomVideoLookup => ({
  video: (videoId) => alexaVideo(userId, videoId),
  followed: () => followedChannels(userId),
});

const defaultKnownSongs =async (videoIds: readonly string[]) => new Set((await musicTracks(videoIds)).keys());

/** How long the rooms list waits for Home Assistant, which a tablet polls. */
const ROOMS_STATE_WAIT_MS = 2500;

/** What Home Assistant reports for each room with an entity, keyed by lower-case room. Never throws. */
export async function homeAssistantByRoom(
  settings: AlexaRoomSettings, homeAssistant: HomeAssistantClient | { disabled: string }, userId: number, now: number,
): Promise<Map<string, { entity: string; report: HomeAssistantReport | null; error: string | null }>> {
  const entities = await settings.entities(userId);
  const result = new Map<string, { entity: string; report: HomeAssistantReport | null; error: string | null }>();
  await Promise.all([...entities].map(async ([key, { entity }]) => {
    if ("disabled" in homeAssistant) {
      result.set(key, { entity, report: null, error: "Home Assistant isn't configured" });
      return;
    }
    try {
      result.set(key, { entity, report: homeAssistantReport(await homeAssistant.state(entity, ROOMS_STATE_WAIT_MS), now), error: null });
    } catch (error) {
      result.set(key, { entity, report: null, error: error instanceof Error ? error.message : String(error) });
    }
  }));
  return result;
}

const publicQueue = (queue: AlexaRoomQueue | null) => queue && {
  queueId: queue.queueId, room: queue.room, title: queue.title, seed: queue.seed, videoIds: queue.videoIds, savedAt: queue.savedAt,
};

/**
 * Room controls through Home Assistant: which Echo entity each room has,
 * pause / resume / next / volume, one-tap pairing, and a queue for the
 * music skill's "play my queue".
 */
export function registerAlexaRoomControlRoutes(api: Hono<ApiEnvironment>, dependencies: AlexaRoomControlDependencies): void {
  const { currentUserId, rooms, settings, now } = dependencies;
  const homeAssistant = dependencies.homeAssistant ?? defaultHomeAssistant;
  const invocations = dependencies.invocations ?? (() => alexaInvocations());
  const skills = dependencies.skills ?? defaultSkills;
  const knownSongs = dependencies.knownSongs ?? defaultKnownSongs;
  const videoLookup = dependencies.videoLookup ?? defaultVideoLookup;

  const roomParam = (context: ApiContext) => normalizeRoomName(context.req.param("room"));
  const body = async (context: ApiContext) => await context.req.json().catch(() => null) as Record<string, unknown> | null;
  const controls = (): RoomControlDependencies | string => {
    const client = homeAssistant();
    if ("disabled" in client) return `Home Assistant isn't configured: ${client.disabled}`;
    return { homeAssistant: client, invocations: invocations(), rooms, settings, skills: skills(), now, sleep: dependencies.sleep };
  };
  const failure = (context: ApiContext, error: unknown) => {
    if (error instanceof RoomControlError) return context.json({ error: error.message }, error.status);
    if (error instanceof HomeAssistantError) return context.json({ error: error.message }, 502);
    throw error;
  };

  // Home Assistant's Alexa media players, to choose each room's Echo from; ?all=1 lists every media player.
  api.get("/alexa/home-assistant", async (context) => {
    const client = homeAssistant();
    const names = invocations();
    if ("disabled" in client) return context.json({ enabled: false, reason: client.disabled, invocations: names, mediaPlayers: [] });
    try {
      const all = context.req.query("all") === "1";
      const states = (await client.mediaPlayers()).filter((state) => all || isAlexaMediaPlayer(state));
      return context.json({
        enabled: true, invocations: names,
        mediaPlayers: states.map((state) => ({
          entity: state.entity_id, name: typeof state.attributes?.friendly_name === "string" ? state.attributes.friendly_name : null,
          state: state.state, alexa: isAlexaMediaPlayer(state),
        })).sort((a, b) => (a.name ?? a.entity).localeCompare(b.name ?? b.entity)),
      });
    } catch (error) {
      return failure(context, error);
    }
  });

  // Maps a room to its Echo's Home Assistant entity, or clears it with entity: null.
  api.put("/alexa/rooms/:room/entity", async (context) => {
    const room = roomParam(context);
    const given = await body(context);
    if (!room) return context.json({ error: "invalid room" }, 400);
    if (given?.entity !== null && !isMediaPlayerEntity(given?.entity)) return context.json({ error: "entity must be a media_player entity ID, or null" }, 400);
    const userId = currentUserId(context);
    const spelled = await roomSpelling(await rooms.devices(userId), settings, userId, room);
    const entity = given.entity as string | null;
    const client = homeAssistant();
    if (entity && !("disabled" in client)) {
      try {
        await client.state(entity);
      } catch (error) {
        if (error instanceof HomeAssistantError && error.status === 404) return context.json({ error: `Home Assistant has no ${entity}` }, 400);
        return failure(context, error);
      }
    }
    await settings.setEntity(userId, spelled, entity, now());
    return context.json({ room: spelled, entity });
  });

  api.post("/alexa/rooms/:room/control", async (context) => {
    const room = roomParam(context);
    const action = parseRoomAction(await body(context));
    if (!room) return context.json({ error: "invalid room" }, 400);
    if (!action) return context.json({ error: "action must be pause, resume, next, or volume with a volume from 0 to 10" }, 400);
    const ready = controls();
    if (typeof ready === "string") return context.json({ error: ready }, 503);
    try {
      return context.json(await controlRoom(ready, currentUserId(context), room, action));
    } catch (error) {
      return failure(context, error);
    }
  });

  // Pairs the room's Echo with every skill in one call; answers once each skill has claimed it or timed out.
  api.post("/alexa/rooms/:room/pair", async (context) => {
    const room = roomParam(context);
    if (!room) return context.json({ error: "invalid room" }, 400);
    const ready = controls();
    if (typeof ready === "string") return context.json({ error: ready }, 503);
    try {
      return context.json(await pairRoom(ready, currentUserId(context), room, dependencies.pairWaitMs));
    } catch (error) {
      return failure(context, error);
    }
  });

  api.get("/alexa/rooms/:room/queue", async (context) => {
    const room = roomParam(context);
    if (!room) return context.json({ error: "invalid room" }, 400);
    return context.json({ queue: publicQueue(await settings.queue(currentUserId(context), room)) });
  });

  // Saves the room's queue: { videoIds: [...] } or { seed: { kind: "album", browseId } }, with an optional title. play: true starts it.
  api.put("/alexa/rooms/:room/queue", async (context) => {
    const room = roomParam(context);
    const given = await body(context);
    if (!room || !given) return context.json({ error: "invalid room or body" }, 400);
    const seed = given.seed == null ? null : parseStationSeed(given.seed);
    const videoIds = given.videoIds == null ? [] : cleanVideoIds(given.videoIds);
    if (given.seed != null && !seed) return context.json({ error: "invalid seed" }, 400);
    if (!videoIds) return context.json({ error: "videoIds must be a list of video IDs" }, 400);
    if (Boolean(seed) === Boolean(videoIds.length)) return context.json({ error: "give either videoIds or a seed" }, 400);
    const known = videoIds.length ? await knownSongs(videoIds) : new Set<string>();
    const unknown = videoIds.filter((id) => !known.has(id));
    if (unknown.length) return context.json({ error: "some songs aren't in the music catalog", unknown }, 400);
    const userId = currentUserId(context);
    const spelled = await roomSpelling(await rooms.devices(userId), settings, userId, room);
    const title = typeof given.title === "string" ? given.title.replace(/\s+/g, " ").trim() : "";
    const queue = await settings.saveQueue(userId, spelled, { title, seed, videoIds }, now());
    if (given.play !== true) return context.json({ queue: publicQueue(queue) });
    const ready = controls();
    if (typeof ready === "string") return context.json({ queue: publicQueue(queue), error: ready }, 503);
    try {
      return context.json({ queue: publicQueue(queue), started: await playRoomQueue(ready, userId, spelled) });
    } catch (error) {
      if (error instanceof RoomControlError || error instanceof HomeAssistantError) {
        return context.json({ queue: publicQueue(queue), error: error.message }, error instanceof RoomControlError ? error.status : 502);
      }
      throw error;
    }
  });

  api.delete("/alexa/rooms/:room/queue", async (context) => {
    const room = roomParam(context);
    if (!room) return context.json({ error: "invalid room" }, 400);
    return await settings.clearQueue(currentUserId(context), room) ? context.json({ ok: true }) : context.json({ error: "not found" }, 404);
  });

  // Starts a video, a channel's latest or a channel shuffle on the room's Echo, through the video skill.
  api.post("/alexa/rooms/:room/video", async (context) => {
    const room = roomParam(context);
    const request = parseRoomVideoRequest(await body(context));
    if (!room) return context.json({ error: "invalid room" }, 400);
    if (!request) return context.json({ error: "give { kind: \"video\", videoId } or { kind: \"latest\" | \"shuffle\", channelId }" }, 400);
    const ready = controls();
    if (typeof ready === "string") return context.json({ error: ready }, 503);
    const userId = currentUserId(context);
    try {
      return context.json(await playRoomVideo(ready, videoLookup(userId), userId, room, request));
    } catch (error) {
      return failure(context, error);
    }
  });

  // Starts the saved queue on the room's Echo.
  api.post("/alexa/rooms/:room/queue/play", async (context) => {
    const room = roomParam(context);
    if (!room) return context.json({ error: "invalid room" }, 400);
    const userId = currentUserId(context);
    if (!await settings.queue(userId, room)) return context.json({ error: "nothing is queued for this room" }, 404);
    const ready = controls();
    if (typeof ready === "string") return context.json({ error: ready }, 503);
    try {
      return context.json(await playRoomQueue(ready, userId, room));
    } catch (error) {
      return failure(context, error);
    }
  });
}

export { defaultHomeAssistant };
