import { http } from "../apiHttp";
import type { MusicSeed } from "../music/musicApi";

/** Which skill, or Home Assistant, a room's screen is showing. */
export type RoomOrigin = "music" | "video" | "home-assistant";
export type AlexaSkill = "music" | "video";

/** What the room's screen should show, as `GET /api/alexa/rooms` works it out. */
export type RoomCurrent = {
  origin: RoomOrigin;
  /** Our skills: playing, paused, stopped, finished, failed. Home Assistant: playing, paused. */
  state: string;
  title: string | null;
  artist: string | null;
  art: string | null;
  durationMs: number | null;
  /** Worked out when the response was sent. */
  positionMs: number | null;
  /** Home Assistant's input name (Local Speaker…); null for our skills. */
  source: string | null;
};

export type RoomNowPlaying = {
  skill: AlexaSkill; videoId: string; title: string; artist: string; art: string; durationMs: number | null;
  state: string; offsetMs: number; startedAt: string | null; positionMs: number; updatedAt: string;
};

/** A play sent to an Echo that it hasn't started yet. */
export type RoomPendingPlay = {
  skill: AlexaSkill; videoId: string; title: string; artist: string; art: string; durationMs: number | null; requestedAt: string;
};

export type RoomHomeAssistant = {
  entity: string;
  error: string | null;
  state?: string;
  title?: string | null;
  artist?: string | null;
  art?: string | null;
  /** 0 to 1. */
  volume?: number | null;
  muted?: boolean | null;
  changedAt?: string | null;
};

export type RoomDevice = {
  skill: AlexaSkill; deviceId: string; room: string | null; pairedAt: string | null; lastSeenAt: string;
  nowPlaying: RoomNowPlaying | null; pending: RoomPendingPlay | null;
};

export type AlexaRoom = {
  room: string;
  nowPlaying: RoomNowPlaying | null;
  pending: RoomPendingPlay | null;
  homeAssistant: RoomHomeAssistant | null;
  current: RoomCurrent | null;
  devices: RoomDevice[];
};

export type AlexaRooms = {
  serverTime: string;
  rooms: AlexaRoom[];
  unpaired: RoomDevice[];
  pairing: { room: string; expiresAt: string; claimed: AlexaSkill[] } | null;
};

export type RoomAction = { action: "pause" } | { action: "resume" } | { action: "next" } | { action: "volume"; volume: number };

/** A station the music skill can start: what the music pages play, less a single track. */
export type RoomSeed = Exclude<MusicSeed, { kind: "track" }>;

export type RoomQueue = { queueId: string; room: string; title: string; seed: RoomSeed | null; videoIds: string[]; savedAt: string };

/** A video by id; one YT Zero doesn't have (a search result) also carries the title and channel to ask the Echo for. */
export type RoomVideoRequest = { kind: "video"; videoId: string; title?: string; channel?: string } | { kind: "latest" | "shuffle"; channelId: string };

export type HomeAssistantPlayers = {
  enabled: boolean;
  reason?: string;
  mediaPlayers: { entity: string; name: string | null; state: string; alexa: boolean }[];
};

export type RoomPairResult = { room: string; entity: string; paired: AlexaSkill[]; failed: { skill: AlexaSkill; reason: string }[] };

const room = (name: string) => `/alexa/rooms/${encodeURIComponent(name)}`;
const send = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

/** The room page's conversation with the server: the Alexa rooms API, signed in as the profile the skills play as. */
export const roomApi = {
  rooms: () => http<AlexaRooms>("/alexa/rooms"),
  control: (name: string, action: RoomAction) => http<{ via: string }>(`${room(name)}/control`, send("POST", action)),
  queue: async (name: string) => (await http<{ queue: RoomQueue | null }>(`${room(name)}/queue`)).queue,
  /** Saves the room's queue and starts it on the room's Echo. */
  playQueue: (name: string, queue: { title: string } & ({ videoIds: string[] } | { seed: RoomSeed })) =>
    http<{ queue: RoomQueue; error?: string }>(`${room(name)}/queue`, send("PUT", { ...queue, play: true })),
  replayQueue: (name: string) => http<{ via: string }>(`${room(name)}/queue/play`, send("POST")),
  playVideo: (name: string, request: RoomVideoRequest) => http<{ via: string }>(`${room(name)}/video`, send("POST", request)),
  homeAssistant: (all = false) => http<HomeAssistantPlayers>(`/alexa/home-assistant${all ? "?all=1" : ""}`),
  setEntity: (name: string, entity: string | null) => http<{ room: string; entity: string | null }>(`${room(name)}/entity`, send("PUT", { entity })),
  pair: (name: string) => http<RoomPairResult>(`${room(name)}/pair`, send("POST")),
  /** Keeps a wall tablet signed in: extends this browser's session by another full lifetime. */
  renewSession: () => http<{ ok: true; renewed: boolean }>("/auth/session/renew", send("POST"), { suppressAuthenticationNavigation: true }),
};
