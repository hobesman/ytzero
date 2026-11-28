import type { Context, Hono } from "hono";
import type { AlexaSkillKind, NowPlaying } from "../alexa/alexaNowPlaying";
import { nowPlayingPosition } from "../alexa/alexaNowPlaying";
import { createAlexaRoomStore, normalizeRoomName, type AlexaDevice, type AlexaRoomStore } from "../alexa/alexaRooms";
import { createAlexaRoomSettings, type AlexaRoomSettings } from "../alexa/alexaRoomSettings";
import { homeAssistantSeesMedia, type HomeAssistantReport } from "../alexa/homeAssistant";
import { isChildUser } from "../childTime";
import { bookNowPlaying, type BookNowPlaying } from "../alexa/alexaBookNowPlaying";
import type { Book } from "../audiobookshelf/audiobookshelfClient";
import { roomBookLoader } from "./alexaBookApiRoutes";
import { defaultHomeAssistant, homeAssistantByRoom, registerAlexaRoomControlRoutes, type AlexaRoomControlDependencies } from "./alexaRoomControlRoutes";

type ApiEnvironment = { Variables: { userId: number } };
type ApiContext = Context<ApiEnvironment>;

export interface AlexaRoomRouteDependencies {
  currentUserId: (context: ApiContext) => number;
  rooms?: AlexaRoomStore;
  isChild?: (userId: number) => Promise<boolean>;
  now?: () => number;
  roomSettings?: AlexaRoomSettings;
  /** Home Assistant, invocation names and the rest of the room controls' wiring. */
  control?: Partial<Omit<AlexaRoomControlDependencies, "currentUserId" | "rooms" | "settings" | "now">>;
}

const SKILLS = new Set<AlexaSkillKind>(["music", "video", "books"]);
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

/** A book's now playing also carries its chapter and its place in the whole book. */
async function withBook(
  item: ReturnType<typeof publicNowPlaying>, record: NowPlaying, loadBook: ((bookId: string) => Promise<Book | null>) | null,
): Promise<ReturnType<typeof publicNowPlaying> & { book?: BookNowPlaying | null }> {
  if (item.skill !== "books") return item;
  const book = loadBook ? await loadBook(record.videoId) : null;
  return { ...item, book: book ? bookNowPlaying(book, record.token, item.positionMs) : null };
}

/** A play sent but not started anywhere for this long never will be. */
export const ALEXA_PENDING_PLAY_TTL_MS = 2 * 60 * 1000;

/** What the device was asked to play and hasn't started yet, while that is still likely to happen. */
function publicPending(device: AlexaDevice, now: number) {
  const pending = device.pending;
  if (!pending || now - Date.parse(pending.requestedAt) > ALEXA_PENDING_PLAY_TTL_MS) return null;
  return { skill: device.skill, videoId: pending.videoId, ...pending.item, requestedAt: pending.requestedAt };
}

const publicDevice = (device: AlexaDevice, now: number) => ({
  skill: device.skill,
  deviceId: device.deviceId,
  room: device.room,
  pairedAt: device.pairedAt,
  lastSeenAt: device.lastSeenAt,
  nowPlaying: device.nowPlaying ? publicNowPlaying(device.skill, device.nowPlaying, now) : null,
  pending: publicPending(device, now),
});

/**
 * What the room's screen should show: our skills' record while it plays, else
 * what Home Assistant sees (Amazon Music, say), else our last record. Home
 * Assistant keeps reporting the last Amazon song, paused, after our skill takes
 * over, so it counts only when it changed after our record did: otherwise the
 * gap between two of our songs would show that old song.
 */
function roomCurrent(ours: (ReturnType<typeof publicNowPlaying> & { book?: BookNowPlaying | null }) | null, seen: HomeAssistantReport | null) {
  // A book shows its chapter's progress, and the whole book's beside it.
  const book = ours?.book ?? null;
  const progress = book?.chapterDurationMs != null ? { durationMs: book.chapterDurationMs, positionMs: book.chapterPositionMs } : { durationMs: ours?.durationMs ?? null, positionMs: ours?.positionMs ?? null };
  const fromOurs = ours && { origin: ours.skill, videoId: ours.videoId, state: ours.state, title: ours.title, artist: ours.artist, art: ours.art, ...progress, source: null, ...(book ? { book } : {}) };
  if (ours?.state === "playing") return fromOurs;
  const stale = ours && seen?.changedAt && Date.parse(seen.changedAt) < Date.parse(ours.updatedAt);
  if (seen && homeAssistantSeesMedia(seen) && !stale) {
    return { origin: "home-assistant" as const, state: seen.state, title: seen.title, artist: seen.artist, art: seen.art, durationMs: seen.durationMs, positionMs: seen.positionMs, source: seen.source };
  }
  return fromOurs;
}

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
  const settings = dependencies.roomSettings ?? createAlexaRoomSettings();
  const homeAssistant = dependencies.control?.homeAssistant ?? defaultHomeAssistant;

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
    const seen = await homeAssistantByRoom(settings, homeAssistant(), userId, at);
    const entities = await settings.entities(userId);
    for (const key of entities.keys()) if (!byRoom.has(key)) byRoom.set(key, []);
    const loadBook = roomBookLoader(dependencies.control?.audiobookshelf);
    const list = (await Promise.all([...byRoom].map(async ([key, members]) => {
      const playing = roomNowPlaying(members);
      const pending = members.map((device) => publicPending(device, at)).filter((item) => item !== null)
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0] ?? null;
      const nowPlaying = playing ? await withBook(publicNowPlaying(playing.skill, playing.nowPlaying!, at), playing.nowPlaying!, loadBook) : null;
      const homeAssistantState = seen.get(key) ?? null;
      return {
        room: members[0]?.room ?? entities.get(key)!.room,
        nowPlaying,
        pending,
        homeAssistant: homeAssistantState && { entity: homeAssistantState.entity, error: homeAssistantState.error, ...homeAssistantState.report },
        current: roomCurrent(nowPlaying, homeAssistantState?.report ?? null),
        devices: members.map((device) => publicDevice(device, at)),
      };
    }))).sort((a, b) => a.room.localeCompare(b.room));
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
    const userId = currentUserId(context);
    const devices = await rooms.renameRoom(userId, from, to);
    // A room may have settings (its Home Assistant entity, a queue) and no device yet.
    const settingsMoved = await settings.rename(userId, from, to);
    return devices || settingsMoved ? context.json({ room: to, devices }) : context.json({ error: "not found" }, 404);
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

  registerAlexaRoomControlRoutes(api, { ...dependencies.control, homeAssistant, currentUserId, rooms, settings, now });
}
