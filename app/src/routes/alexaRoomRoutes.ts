import type { Context, Hono } from "hono";
import type { AlexaSkillKind, NowPlaying } from "../alexa/alexaNowPlaying";
import { nowPlayingPosition } from "../alexa/alexaNowPlaying";
import { createAlexaRoomStore, normalizeRoomName, type AlexaDevice, type AlexaRoomStore } from "../alexa/alexaRooms";
import { isChildUser } from "../childTime";

type ApiEnvironment = { Variables: { userId: number } };
type ApiContext = Context<ApiEnvironment>;

export interface AlexaRoomRouteDependencies {
  currentUserId: (context: ApiContext) => number;
  rooms?: AlexaRoomStore;
  isChild?: (userId: number) => Promise<boolean>;
  now?: () => number;
}

const SKILLS = new Set<AlexaSkillKind>(["music", "video"]);
const parseSkill = (value: unknown): AlexaSkillKind | null => SKILLS.has(value as AlexaSkillKind) ? value as AlexaSkillKind : null;
const parseDeviceId = (value: unknown): string | null => typeof value === "string" && value && value.length <= 512 ? value : null;

/** Now playing as a client shows it: the token stays on the server, and the position is live. */
function publicNowPlaying(skill: AlexaSkillKind, record: NowPlaying, now: number) {
  return {
    skill,
    videoId: record.videoId,
    title: record.title,
    artist: record.artist,
    art: record.art,
    durationMs: record.durationMs,
    state: record.state,
    offsetMs: record.offsetMs,
    startedAt: record.startedAt,
    positionMs: nowPlayingPosition(record, now),
    updatedAt: record.updatedAt,
  };
}

const publicDevice = (device: AlexaDevice, now: number) => ({
  skill: device.skill,
  deviceId: device.deviceId,
  room: device.room,
  pairedAt: device.pairedAt,
  lastSeenAt: device.lastSeenAt,
  nowPlaying: device.nowPlaying ? publicNowPlaying(device.skill, device.nowPlaying, now) : null,
});

/** What a room is playing: whatever is playing now, else whichever device changed last. */
function roomNowPlaying(devices: AlexaDevice[]): AlexaDevice | null {
  const withRecord = devices.filter((device) => device.nowPlaying);
  withRecord.sort((a, b) => Number(b.nowPlaying!.state === "playing") - Number(a.nowPlaying!.state === "playing")
    || b.nowPlaying!.updatedAt.localeCompare(a.nowPlaying!.updatedAt));
  return withRecord[0] ?? null;
}

/**
 * Echo devices, their rooms and what each room is playing, for a wall tablet.
 * Records belong to the profile the Alexa skills play as, so the tablet signs
 * in as that profile.
 */
export function registerAlexaRoomRoutes(api: Hono<ApiEnvironment>, dependencies: AlexaRoomRouteDependencies): void {
  const { currentUserId } = dependencies;
  const rooms = dependencies.rooms ?? createAlexaRoomStore();
  const isChild = dependencies.isChild ?? isChildUser;
  const now = dependencies.now ?? Date.now;

  api.use("/alexa/*", async (context, next) => {
    if (await isChild(currentUserId(context))) return context.json({ error: "not allowed" }, 403);
    await next();
  });

  api.get("/alexa/rooms", async (context) => {
    const userId = currentUserId(context);
    const at = now();
    const devices = await rooms.devices(userId);
    const byRoom = new Map<string, AlexaDevice[]>();
    for (const device of devices) {
      if (!device.room) continue;
      const key = device.room.toLowerCase();
      byRoom.set(key, [...byRoom.get(key) ?? [], device]);
    }
    const list = [...byRoom.values()].map((members) => {
      const playing = roomNowPlaying(members);
      return {
        room: members[0]!.room!,
        nowPlaying: playing ? publicNowPlaying(playing.skill, playing.nowPlaying!, at) : null,
        devices: members.map((device) => publicDevice(device, at)),
      };
    }).sort((a, b) => a.room.localeCompare(b.room));
    return context.json({
      serverTime: new Date(at).toISOString(),
      rooms: list,
      unpaired: devices.filter((device) => !device.room).map((device) => publicDevice(device, at)),
      pairing: await rooms.pairing(userId, at),
    });
  });

  api.get("/alexa/devices", async (context) => {
    const at = now();
    const devices = await rooms.devices(currentUserId(context));
    return context.json({ serverTime: new Date(at).toISOString(), devices: devices.map((device) => publicDevice(device, at)) });
  });

  // Names a device's room, or unpairs it with room: null.
  api.patch("/alexa/devices", async (context) => {
    const body = await context.req.json().catch(() => null) as Record<string, unknown> | null;
    const skill = parseSkill(body?.skill);
    const deviceId = parseDeviceId(body?.deviceId);
    if (!skill || !deviceId) return context.json({ error: "skill and deviceId are required" }, 400);
    const room = body?.room === null ? null : normalizeRoomName(body?.room);
    if (body?.room !== null && !room) return context.json({ error: "invalid room" }, 400);
    const userId = currentUserId(context);
    const known = (await rooms.devices(userId)).some((device) => device.skill === skill && device.deviceId === deviceId);
    if (!known) return context.json({ error: "not found" }, 404);
    return context.json({ room: await rooms.setRoom(userId, skill, deviceId, room, now()) });
  });

  api.delete("/alexa/devices", async (context) => {
    const body = await context.req.json().catch(() => null) as Record<string, unknown> | null;
    const skill = parseSkill(body?.skill);
    const deviceId = parseDeviceId(body?.deviceId);
    if (!skill || !deviceId) return context.json({ error: "skill and deviceId are required" }, 400);
    return await rooms.forget(currentUserId(context), skill, deviceId) ? context.json({ ok: true }) : context.json({ error: "not found" }, 404);
  });

  api.post("/alexa/rooms/rename", async (context) => {
    const body = await context.req.json().catch(() => null) as Record<string, unknown> | null;
    const from = normalizeRoomName(body?.from);
    const to = normalizeRoomName(body?.to);
    if (!from || !to) return context.json({ error: "from and to are required" }, 400);
    const changed = await rooms.renameRoom(currentUserId(context), from, to);
    return changed ? context.json({ room: to, devices: changed }) : context.json({ error: "not found" }, 404);
  });

  // The room the next Echo told "pair" takes, for a couple of minutes.
  api.post("/alexa/pairing", async (context) => {
    const body = await context.req.json().catch(() => null) as Record<string, unknown> | null;
    const room = normalizeRoomName(body?.room);
    if (!room) return context.json({ error: "invalid room" }, 400);
    return context.json(await rooms.startPairing(currentUserId(context), room, now()));
  });

  api.delete("/alexa/pairing", async (context) => {
    await rooms.cancelPairing(currentUserId(context));
    return context.json({ ok: true });
  });
}
