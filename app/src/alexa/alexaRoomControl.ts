import { log } from "../logger";
import type { AlexaSkillKind, NowPlaying } from "./alexaNowPlaying";
import type { AlexaDevice, AlexaRoomStore } from "./alexaRooms";
import type { AlexaRoomSettings } from "./alexaRoomSettings";
import {
  homeAssistantReport, homeAssistantSeesMedia, type AlexaInvocations, type HomeAssistantClient, type HomeAssistantReport,
} from "./homeAssistant";

/**
 * Controls a room's Echo through Home Assistant. Home Assistant can't see a
 * skill's audio (it shows the Echo as idle), so while one of our skills plays
 * there, or when Home Assistant sees nothing, the Echo gets a typed command, as
 * if spoken. What Home Assistant can see playing (Amazon Music, say) it
 * controls with its own media_player services.
 */
export interface RoomControlDependencies {
  homeAssistant: HomeAssistantClient;
  invocations: AlexaInvocations;
  rooms: AlexaRoomStore;
  settings: AlexaRoomSettings;
  /** The skills this server runs. */
  skills: Record<AlexaSkillKind, boolean>;
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type RoomAction = { action: "pause" } | { action: "resume" } | { action: "next" } | { action: "previous" } | { action: "volume"; volume: number }
  /** Seconds forward, or back when negative, in what our skills play. */
  | { action: "skip"; seconds: number }
  /** A place to jump to, in seconds from the start: of the song or video, or of the whole book. */
  | { action: "seek"; seconds: number };

/** A control failed for a reason the caller should see. */
export class RoomControlError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 502 = 409) {
    super(message);
  }
}

export interface RoomControlResult {
  room: string;
  entity: string;
  /** typed: a command typed to the Echo; home-assistant: one of Home Assistant's media_player services. */
  via: "typed" | "home-assistant";
  command?: string;
  service?: string;
}

const MAX_VOLUME = 10;
const MAX_SKIP_SECONDS = 3600;
/** A day: longer than any book or video, so only nonsense is refused. */
const MAX_SEEK_SECONDS = 86_400;

/** "1 hour 2 minutes 5 seconds", as typed to the Echo for the skill's AMAZON.DURATION slot. */
export function spokenPosition(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const parts: string[] = [];
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  if (rest || !parts.length) parts.push(`${rest} ${rest === 1 ? "second" : "seconds"}`);
  return parts.join(" ");
}

/** The variable naming each skill's invocation. */
export const INVOCATION_VARIABLES: Record<AlexaSkillKind, string> = {
  music: "YTZERO_ALEXA_MUSIC_INVOCATION", video: "YTZERO_ALEXA_VIDEO_INVOCATION", books: "YTZERO_ALEXA_BOOKS_INVOCATION",
};

export function parseRoomAction(body: Record<string, unknown> | null): RoomAction | null {
  const action = body?.action;
  if (action === "pause" || action === "resume" || action === "next" || action === "previous") return { action };
  if (action === "skip") {
    const seconds = Number(body?.seconds);
    return Number.isInteger(seconds) && seconds !== 0 && Math.abs(seconds) <= MAX_SKIP_SECONDS ? { action, seconds } : null;
  }
  if (action === "seek") {
    const seconds = Number(body?.seconds);
    return Number.isFinite(seconds) && seconds >= 0 && seconds <= MAX_SEEK_SECONDS ? { action, seconds: Math.round(seconds) } : null;
  }
  if (action === "volume") {
    const volume = Number(body?.volume);
    return Number.isInteger(volume) && volume >= 0 && volume <= MAX_VOLUME ? { action, volume } : null;
  }
  return null;
}

/** The record our skills keep for the room: the device playing, else the one that changed last. */
export function roomRecord(devices: readonly AlexaDevice[], room: string): { skill: AlexaSkillKind; record: NowPlaying } | null {
  const inRoom = devices.filter((device) => device.room?.toLowerCase() === room.toLowerCase() && device.nowPlaying);
  inRoom.sort((a, b) => Number(b.nowPlaying!.state === "playing") - Number(a.nowPlaying!.state === "playing")
    || b.nowPlaying!.updatedAt.localeCompare(a.nowPlaying!.updatedAt));
  const device = inRoom[0];
  return device ? { skill: device.skill, record: device.nowPlaying! } : null;
}

/** The room as its devices spell it, else as its settings do, else as given. */
export async function roomSpelling(devices: readonly AlexaDevice[], settings: AlexaRoomSettings, userId: number, room: string): Promise<string> {
  return devices.find((device) => device.room?.toLowerCase() === room.toLowerCase())?.room ?? await settings.spelling(userId, room) ?? room;
}

function invocation(invocations: AlexaInvocations, skill: AlexaSkillKind): string {
  const name = invocations[skill];
  if (!name) throw new RoomControlError(`Set ${INVOCATION_VARIABLES[skill]} to the skill's invocation name first.`);
  return name;
}

async function roomEntity(dependencies: RoomControlDependencies, userId: number, room: string): Promise<string> {
  const entity = await dependencies.settings.entity(userId, room);
  if (!entity) throw new RoomControlError(`The ${room} has no Home Assistant Echo yet. Set one with PUT /api/alexa/rooms/${encodeURIComponent(room)}/entity.`);
  return entity;
}

async function reportOrNull(homeAssistant: HomeAssistantClient, entity: string, now: number): Promise<HomeAssistantReport | null> {
  try {
    return homeAssistantReport(await homeAssistant.state(entity), now);
  } catch (error) {
    log.warn("alexa.home_assistant_state_failed", { entity, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

const homeAssistantError = (error: unknown) => new RoomControlError(error instanceof Error ? error.message : String(error), 502);

export async function controlRoom(dependencies: RoomControlDependencies, userId: number, roomName: string, action: RoomAction): Promise<RoomControlResult> {
  const { homeAssistant } = dependencies;
  const devices = await dependencies.rooms.devices(userId);
  const room = await roomSpelling(devices, dependencies.settings, userId, roomName);
  const entity = await roomEntity(dependencies, userId, room);
  const typed = async (command: string): Promise<RoomControlResult> => {
    try { await homeAssistant.typeCommand(entity, command); } catch (error) { throw homeAssistantError(error); }
    log.info("alexa.room_control", { room, action: action.action, via: "typed", command });
    return { room, entity, via: "typed", command };
  };
  const service = async (name: "media_pause" | "media_play" | "media_next_track" | "media_previous_track" | "volume_set" | "media_seek", data?: Record<string, unknown>): Promise<RoomControlResult> => {
    try { await homeAssistant.service(name, entity, data); } catch (error) { throw homeAssistantError(error); }
    log.info("alexa.room_control", { room, action: action.action, via: "home-assistant", service: name });
    return { room, entity, via: "home-assistant", service: name };
  };

  if (action.action === "volume") {
    // The Echo's own volume, whatever it plays; a typed command only if Home Assistant can't set it.
    try {
      return await service("volume_set", { volume_level: action.volume / MAX_VOLUME });
    } catch (error) {
      log.warn("alexa.room_volume_fallback", { room, error: error instanceof Error ? error.message : String(error) });
      return typed(`volume ${action.volume}`);
    }
  }

  const ours = roomRecord(devices, room);
  const report = await reportOrNull(homeAssistant, entity, dependencies.now());
  const seen = report && homeAssistantSeesMedia(report) ? report : null;
  const oursPlaying = ours?.record.state === "playing";

  if (action.action === "pause") {
    return !oursPlaying && seen?.state === "playing" ? service("media_pause") : typed("pause");
  }
  if (action.action === "next") {
    // For a book, next is the next chapter: the Echo hands "next" to the skill playing.
    return !oursPlaying && seen ? service("media_next_track") : typed("next");
  }
  if (action.action === "previous") {
    return !oursPlaying && seen ? service("media_previous_track") : typed("previous");
  }
  if (action.action === "skip" || action.action === "seek") {
    // What Home Assistant sees playing it moves itself, if the Echo lets it; our skills get the command typed.
    if (seen && !oursPlaying) {
      if (!seen.canSeek) throw new RoomControlError(`The ${room} Echo can't jump within what it's playing.`);
      const to = action.action === "seek" ? action.seconds : Math.max(0, (seen.positionMs ?? 0) / 1000 + action.seconds);
      return service("media_seek", { seek_position: Math.round(to) });
    }
    if (!ours) throw new RoomControlError(`Nothing of ours is playing in the ${room}.`);
    const name = invocation(dependencies.invocations, ours.skill);
    if (action.action === "seek") return typed(`ask ${name} to jump to ${spokenPosition(action.seconds)}`);
    const amount = spokenPosition(Math.abs(action.seconds));
    return typed(`ask ${name} to ${action.seconds > 0 ? `skip forward ${amount}` : `go back ${amount}`}`);
  }
  // Resume whichever paused last: what Home Assistant sees, or our skill's song.
  const oursPaused = ours && (ours.record.state === "paused" || ours.record.state === "stopped") ? ours : null;
  const seenPausedLater = seen?.state === "paused" && (!oursPaused || (seen.changedAt ?? "") > oursPaused.record.updatedAt);
  if (!oursPlaying && seenPausedLater) return service("media_play");
  const skill = oursPaused?.skill ?? ours?.skill ?? "music";
  return typed(`ask ${invocation(dependencies.invocations, skill)} to resume`);
}

/** How long one skill gets to claim the pairing after its command is typed. */
export const PAIR_WAIT_MS = 30_000;
const PAIR_POLL_MS = 1000;

export interface PairResult {
  room: string;
  entity: string;
  paired: AlexaSkillKind[];
  failed: { skill: AlexaSkillKind; reason: string }[];
}

/**
 * One-tap pairing: sets the room waiting, then types "ask <skill> to pair" to
 * the room's Echo for each skill in turn, waiting for that skill to claim it.
 */
export async function pairRoom(dependencies: RoomControlDependencies, userId: number, roomName: string, waitMs = PAIR_WAIT_MS): Promise<PairResult> {
  const { rooms, homeAssistant, now } = dependencies;
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const devices = await rooms.devices(userId);
  const room = await roomSpelling(devices, dependencies.settings, userId, roomName);
  const entity = await roomEntity(dependencies, userId, room);
  const skills = (["music", "video", "books"] as const).filter((skill) => dependencies.skills[skill]);
  if (!skills.length) throw new RoomControlError("No Alexa skill is configured.");
  const named = skills.filter((skill) => dependencies.invocations[skill]);
  if (!named.length) invocation(dependencies.invocations, skills[0]!);

  const waiting = await rooms.startPairing(userId, room, now());
  const result: PairResult = {
    room: waiting.room, entity, paired: [],
    failed: skills.filter((skill) => !named.includes(skill)).map((skill) => ({ skill, reason: `${INVOCATION_VARIABLES[skill]} isn't set` })),
  };
  try {
    for (const skill of named) {
      const command = `ask ${dependencies.invocations[skill]} to pair`;
      try {
        await homeAssistant.typeCommand(entity, command);
      } catch (error) {
        result.failed.push({ skill, reason: error instanceof Error ? error.message : String(error) });
        continue;
      }
      const deadline = now() + waitMs;
      let claimed = false;
      while (!claimed && now() < deadline) {
        await sleep(PAIR_POLL_MS);
        const pairing = await rooms.pairing(userId, now());
        if (!pairing) break;
        claimed = pairing.claimed.includes(skill);
      }
      if (claimed) result.paired.push(skill);
      else result.failed.push({ skill, reason: `the Echo didn't answer "${command}" in time` });
    }
  } finally {
    await rooms.cancelPairing(userId);
  }
  log.info("alexa.room_paired", { room: result.room, paired: result.paired.join(",") || "none", failed: result.failed.map((item) => item.skill).join(",") || "none" });
  return result;
}

/** Starts the book queued for the room: types "ask <books skill> to play my book" to its Echo. */
export async function playRoomBook(dependencies: RoomControlDependencies, userId: number, roomName: string): Promise<RoomControlResult> {
  const devices = await dependencies.rooms.devices(userId);
  const room = await roomSpelling(devices, dependencies.settings, userId, roomName);
  const entity = await roomEntity(dependencies, userId, room);
  if (!dependencies.skills.books) throw new RoomControlError("The Hoban Books skill isn't configured.");
  const command = `ask ${invocation(dependencies.invocations, "books")} to play my book`;
  try { await dependencies.homeAssistant.typeCommand(entity, command); } catch (error) { throw homeAssistantError(error); }
  log.info("alexa.room_book_started", { room });
  return { room, entity, via: "typed", command };
}

/** Starts the room's queue: types "ask <music skill> to play my queue" to its Echo. */
export async function playRoomQueue(dependencies: RoomControlDependencies, userId: number, roomName: string): Promise<RoomControlResult> {
  const devices = await dependencies.rooms.devices(userId);
  const room = await roomSpelling(devices, dependencies.settings, userId, roomName);
  const entity = await roomEntity(dependencies, userId, room);
  if (!dependencies.skills.music) throw new RoomControlError("The music skill isn't configured.");
  const command = `ask ${invocation(dependencies.invocations, "music")} to play my queue`;
  try { await dependencies.homeAssistant.typeCommand(entity, command); } catch (error) { throw homeAssistantError(error); }
  log.info("alexa.room_queue_started", { room });
  return { room, entity, via: "typed", command };
}
