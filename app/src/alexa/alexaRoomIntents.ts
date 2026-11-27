import { log } from "../logger";
import { applyNowPlayingChange, nowPlayingChange, type AlexaSkillKind, type NowPlayingItem } from "./alexaNowPlaying";
import { speak, type AlexaResponse } from "./alexaPlayback";
import { normalizeRoomName, type AlexaRoomStore } from "./alexaRooms";
import { envelopeDeviceId, type AlexaEnvelope } from "./alexaSkill";

/**
 * Pairing an Echo with a room, answered the same way by both skills before
 * the skill itself sees the request:
 *  - "pair": the Echo takes the room an authenticated API call set just before;
 *  - "this is the kitchen": the Echo names its own room;
 *  - "which room is this?": says the room.
 */
export const ROOM_INTENTS = new Set(["PairDeviceIntent", "SetRoomIntent", "WhichRoomIntent"]);

const ASK_ROOM = "Which room is this? Say, for example, this is the kitchen.";

export async function answerRoomIntent(rooms: AlexaRoomStore, userId: number, skill: AlexaSkillKind, envelope: AlexaEnvelope, now: number): Promise<AlexaResponse | null> {
  if (envelope.request?.type !== "IntentRequest") return null;
  const name = envelope.request.intent?.name ?? "";
  if (!ROOM_INTENTS.has(name)) return null;
  try {
    return await roomIntent(rooms, userId, skill, envelope, name, now);
  } catch (error) {
    log.warn("alexa.room_intent_failed", { skill, intent: name, error: error instanceof Error ? error.message : String(error) });
    return speak("Sorry, I couldn't save that right now. Please try again in a moment.");
  }
}

async function roomIntent(rooms: AlexaRoomStore, userId: number, skill: AlexaSkillKind, envelope: AlexaEnvelope, name: string, now: number): Promise<AlexaResponse> {
  const deviceId = envelopeDeviceId(envelope);
  if (!deviceId) return speak("I can't tell which device this is.");
  if (name === "WhichRoomIntent") {
    const room = await rooms.room(userId, skill, deviceId);
    return room ? speak(`This is the ${room}.`) : speak(`This device isn't paired with a room yet. ${ASK_ROOM}`, ASK_ROOM);
  }
  if (name === "PairDeviceIntent") {
    const room = await rooms.claimPairing(userId, skill, now);
    if (!room) return speak(`There's no pairing waiting. ${ASK_ROOM}`, ASK_ROOM);
    await rooms.setRoom(userId, skill, deviceId, room, now);
    log.info("alexa.device_paired", { skill, room, by: "pairing" });
    return speak(`Paired. This is the ${room}.`);
  }
  const room = normalizeRoomName(envelope.request?.intent?.slots?.room?.value, true);
  if (!room) return speak(ASK_ROOM, ASK_ROOM);
  const stored = await rooms.setRoom(userId, skill, deviceId, room, now);
  log.info("alexa.device_paired", { skill, room: stored, by: "voice" });
  return speak(`Okay, this is the ${stored}.`);
}

export interface NowPlayingTracking {
  rooms: AlexaRoomStore;
  /** The video a stream token plays and what the catalog says about it. */
  describe: (skill: AlexaSkillKind, userId: number, token: string) => Promise<{ videoId: string; item: NowPlayingItem } | null>;
}

/**
 * Records the device behind a request and what it is now playing. Never
 * throws: Alexa's answer matters more than the record.
 */
export async function trackDevice(tracking: NowPlayingTracking, userId: number, skill: AlexaSkillKind, envelope: AlexaEnvelope, response: AlexaResponse, now: number): Promise<void> {
  const deviceId = envelopeDeviceId(envelope);
  if (!deviceId) return;
  try {
    await tracking.rooms.seen(userId, skill, deviceId, now);
    const change = nowPlayingChange(envelope, response);
    if (!change) return;
    const before = {
      current: await tracking.rooms.nowPlaying(userId, skill, deviceId),
      pending: await tracking.rooms.pending(userId, skill, deviceId),
    };
    const at = Date.parse(envelope.request?.timestamp ?? "");
    const after = await applyNowPlayingChange(before, change, { at: Number.isFinite(at) ? at : now, now }, {
      lookup: (token) => tracking.describe(skill, userId, token),
      claimElsewhere: (token) => tracking.rooms.claimPending(userId, skill, token, deviceId),
    });
    if (after.current) await tracking.rooms.saveNowPlaying(userId, skill, deviceId, after.current);
    if (after.pending !== before.pending) await tracking.rooms.savePending(userId, skill, deviceId, after.pending);
  } catch (error) {
    log.warn("alexa.now_playing_failed", { skill, error: error instanceof Error ? error.message : String(error) });
  }
}
