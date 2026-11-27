import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { AsyncDatabaseClient } from "../databaseClient";
import type { StoredMusicTrack } from "../music/musicCatalog";
import { createAlexaRouter } from "../routes/alexaRoutes";
import { registerAlexaRoomRoutes } from "../routes/alexaRoomRoutes";
import type { AlexaConfig } from "./alexaConfig";
import { applyNowPlayingChange, nowPlayingChange, nowPlayingPosition, type NowPlaying } from "./alexaNowPlaying";
import { ALEXA_PAIRING_TTL_MS, createAlexaRoomStore, normalizeRoomName, type AlexaRoomStore } from "./alexaRooms";
import type { AlexaEnvelope } from "./alexaSkill";

const NOW = Date.parse("2030-06-01T12:00:00Z");
const id = (n: number) => `vid${String(n).padStart(8, "0")}`;
const KITCHEN = "amzn1.ask.device.KITCHEN";
const OFFICE = "amzn1.ask.device.OFFICE";

async function memoryStore(): Promise<{ db: AsyncDatabaseClient; rooms: AlexaRoomStore }> {
  const db = new AsyncDatabaseClient("sqlite", ":memory:");
  await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY)");
  await db.exec("INSERT INTO users (id) VALUES (1), (2)");
  await db.exec(readFileSync(new URL("../alexaSchema.sql", import.meta.url), "utf8"));
  return { db, rooms: createAlexaRoomStore(db) };
}

const play = (token: string, videoId: string, behavior = "REPLACE_ALL", offsetInMilliseconds = 0) => ({
  version: "1.0" as const,
  response: { directives: [{
    type: "AudioPlayer.Play", playBehavior: behavior,
    audioItem: { stream: { url: `https://yt.example.com/alexa/audio/${videoId}?u=1&s=x`, token, offsetInMilliseconds }, metadata: { title: `Song ${videoId}`, subtitle: "Artist", art: { sources: [{ url: "https://i.ytimg.com/x.jpg" }] } } },
  }] },
});
const quiet = { version: "1.0" as const, response: {} };
const event = (type: string, token: string, offsetInMilliseconds = 0): AlexaEnvelope => ({ request: { type, token, offsetInMilliseconds, timestamp: new Date(NOW).toISOString() } });
const describeNothing = async () => null;

describe("alexa now playing", () => {
  test("follows a stream from Play through pause, the queued next song, and the end", async () => {
    let record: NowPlaying | null = null;
    const step = async (envelope: AlexaEnvelope, response = quiet, at = NOW, lookup: Parameters<typeof applyNowPlayingChange>[3] = describeNothing) => {
      const change = nowPlayingChange(envelope, response);
      if (change) record = await applyNowPlayingChange(record, change, { at, now: at }, lookup);
      return record!;
    };

    const started = await step({ request: { type: "IntentRequest", intent: { name: "PlaySongIntent" } } }, play("t1", id(1)));
    expect(started).toMatchObject({ token: "t1", videoId: id(1), title: `Song ${id(1)}`, artist: "Artist", art: "https://i.ytimg.com/x.jpg", state: "playing", offsetMs: 0 });

    const confirmed = await step(event("AudioPlayer.PlaybackStarted", "t1", 0), quiet, NOW + 2000);
    expect(confirmed.startedAt).toBe(new Date(NOW + 2000).toISOString());
    expect(nowPlayingPosition(confirmed, NOW + 32_000)).toBe(30_000);

    const paused = await step(event("AudioPlayer.PlaybackStopped", "t1", 30_000));
    expect(paused).toMatchObject({ state: "paused", offsetMs: 30_000, startedAt: null });
    expect(nowPlayingPosition(paused, NOW + 99_000)).toBe(30_000);

    // An event for a stream already replaced says nothing about the current one.
    expect(await step(event("AudioPlayer.PlaybackFinished", "old", 1))).toMatchObject({ token: "t1", state: "paused" });

    await step(event("AudioPlayer.PlaybackNearlyFinished", "t1", 190_000), play("t2", id(2), "ENQUEUE"));
    expect(record!.nextToken).toBe("t2");
    expect(await step(event("AudioPlayer.PlaybackFinished", "t1", 200_000))).toMatchObject({ state: "finished", offsetMs: 200_000 });
    const next = await step(event("AudioPlayer.PlaybackStarted", "t2", 0), quiet, NOW, async (token) => token === "t2"
      ? { videoId: id(2), item: { title: "Second", artist: "Band", art: "", durationMs: 180_000 } } : null);
    expect(next).toMatchObject({ token: "t2", videoId: id(2), title: "Second", durationMs: 180_000, state: "playing", nextToken: null });

    expect(await step({ request: { type: "IntentRequest", intent: { name: "AMAZON.StopIntent" } } })).toMatchObject({ state: "stopped" });
    expect(await step(event("AudioPlayer.PlaybackStopped", "t2", 5000))).toMatchObject({ state: "stopped", offsetMs: 5000 });
  });

  test("a failed stream is marked failed, then replaced by the skill's retry", async () => {
    let record: NowPlaying | null = await applyNowPlayingChange(null, nowPlayingChange({}, play("t1", id(1)))!, { at: NOW, now: NOW }, describeNothing);
    const failed: AlexaEnvelope = { request: { type: "AudioPlayer.PlaybackFailed", token: "t1", currentPlaybackState: { offsetInMilliseconds: 4000 } } };
    record = await applyNowPlayingChange(record, nowPlayingChange(failed, quiet)!, { at: NOW, now: NOW }, describeNothing);
    expect(record).toMatchObject({ state: "failed", offsetMs: 4000 });
    record = await applyNowPlayingChange(record, nowPlayingChange(failed, play("t1r", id(1), "REPLACE_ALL", 4000))!, { at: NOW, now: NOW }, describeNothing);
    expect(record).toMatchObject({ token: "t1r", state: "playing", offsetMs: 4000 });
  });

  test("room names as spoken lose the article and gain capitals", () => {
    expect(normalizeRoomName("the kitchen", true)).toBe("Kitchen");
    expect(normalizeRoomName("  nick's   room. ", true)).toBe("Nick's Room");
    expect(normalizeRoomName("Living room")).toBe("Living room");
    expect(normalizeRoomName("   ")).toBeNull();
    expect(normalizeRoomName(42)).toBeNull();
  });
});

describe("alexa room store", () => {
  test("pairing is claimed once by each skill, and expires", async () => {
    const { rooms } = await memoryStore();
    await rooms.startPairing(1, "Kitchen", NOW);
    expect(await rooms.claimPairing(1, "music", NOW)).toBe("Kitchen");
    expect(await rooms.claimPairing(1, "music", NOW)).toBeNull();
    expect(await rooms.claimPairing(1, "video", NOW)).toBe("Kitchen");
    expect(await rooms.claimPairing(2, "music", NOW)).toBeNull();
    await rooms.startPairing(1, "Office", NOW);
    expect(await rooms.claimPairing(1, "music", NOW + ALEXA_PAIRING_TTL_MS + 1)).toBeNull();
  });

  test("a room keeps the spelling it already has", async () => {
    const { rooms } = await memoryStore();
    expect(await rooms.setRoom(1, "music", KITCHEN, "Kitchen", NOW)).toBe("Kitchen");
    expect(await rooms.setRoom(1, "video", "video-kitchen", "kitchen", NOW)).toBe("Kitchen");
    expect(await rooms.renameRoom(1, "KITCHEN", "Galley")).toBe(2);
    expect((await rooms.devices(1)).map((device) => device.room)).toEqual(["Galley", "Galley"]);
  });
});

describe("alexa rooms end to end", () => {
  const settings: AlexaConfig = { musicSkillId: "amzn1.ask.skill.test", videoSkillId: "amzn1.ask.skill.video", profile: "1", secret: "s".repeat(40), publicUrl: "https://yt.example.com" };
  const track = (videoId: string): StoredMusicTrack => ({
    videoId, title: `Song ${videoId}`, artist: "Artist", artistId: null, album: null, duration: 200,
    thumbnail: "https://i.ytimg.com/x.jpg", isTopic: true, songKey: videoId,
  } as StoredMusicTrack);
  let rooms: AlexaRoomStore;
  let clock = NOW;
  let alexa: Hono;
  let api: Hono<{ Variables: { userId: number } }>;

  beforeEach(async () => {
    ({ rooms } = await memoryStore());
    clock = NOW;
    let counter = 1;
    alexa = createAlexaRouter({
      config: () => settings,
      verifier: { check: async () => null },
      resolveProfile: async () => 1,
      isChild: async () => false,
      rooms,
      describeStream: async () => null,
      now: () => clock,
      skill: {
        client: { searchSongs: async () => [track(id(counter++))], searchAll: async () => ({ albums: [], artists: [] }) },
        stations: { next: async (_userId, seed) => [track(seed.kind === "track" ? seed.videoId : id(counter++))] },
        prepare: () => {},
        audioLink: (videoId, userId) => `https://yt.example.com/alexa/audio/${videoId}?u=${userId}`,
        recordPlay: async () => {},
        findTrack: async (videoId) => track(videoId),
        saveTracks: async (tracks) => tracks as StoredMusicTrack[],
      },
    });
    api = new Hono<{ Variables: { userId: number } }>();
    api.use("*", async (context, next) => { context.set("userId", 1); await next(); });
    registerAlexaRoomRoutes(api, { currentUserId: (context) => context.get("userId"), rooms, isChild: async () => false, now: () => clock });
  });

  const send = async (deviceId: string, request: Record<string, unknown>, skillId = settings.musicSkillId!) => {
    const body = { context: { System: { application: { applicationId: skillId }, device: { deviceId } } }, request: { timestamp: new Date(clock).toISOString(), ...request } };
    return (await alexa.request("/", { method: "POST", body: JSON.stringify(body) })).json() as Promise<{ response: Record<string, any> }>;
  };
  const say = (deviceId: string, name: string, slots: Record<string, { value: string }> = {}, skillId?: string) =>
    send(deviceId, { type: "IntentRequest", intent: { name, slots } }, skillId);
  const roomsNow = async () => (await api.request("/alexa/rooms")).json() as Promise<any>;

  test("two Echos pair with their rooms and report what each plays, separately", async () => {
    // The kitchen pairs through the API, the office by voice.
    expect((await api.request("/alexa/pairing", { method: "POST", body: JSON.stringify({ room: "Kitchen" }) })).status).toBe(200);
    expect((await say(KITCHEN, "PairDeviceIntent")).response.outputSpeech.text).toBe("Paired. This is the Kitchen.");
    expect((await say(OFFICE, "PairDeviceIntent")).response.outputSpeech.text).toContain("There's no pairing waiting.");
    expect((await say(OFFICE, "SetRoomIntent", { room: { value: "the office" } })).response.outputSpeech.text).toBe("Okay, this is the Office.");
    expect((await say(OFFICE, "WhichRoomIntent")).response.outputSpeech.text).toBe("This is the Office.");

    const kitchenPlay = await say(KITCHEN, "PlaySongIntent", { query: { value: "first" } });
    const kitchenToken = kitchenPlay.response.directives[0].audioItem.stream.token;
    await say(OFFICE, "PlaySongIntent", { query: { value: "second" } });
    clock += 1000;
    await send(KITCHEN, { type: "AudioPlayer.PlaybackStarted", token: kitchenToken, offsetInMilliseconds: 0 });
    clock += 60_000;
    await send(KITCHEN, { type: "AudioPlayer.PlaybackStopped", token: kitchenToken, offsetInMilliseconds: 60_000 });
    clock += 5000;

    const view = await roomsNow();
    expect(view.rooms.map((room: any) => room.room)).toEqual(["Kitchen", "Office"]);
    const [kitchen, office] = view.rooms;
    expect(kitchen.nowPlaying).toMatchObject({ skill: "music", videoId: id(1), state: "paused", offsetMs: 60_000, positionMs: 60_000 });
    expect(office.nowPlaying).toMatchObject({ skill: "music", videoId: id(2), state: "playing", positionMs: 66_000 });
    expect(kitchen.nowPlaying).not.toHaveProperty("token");
    expect(view.unpaired).toEqual([]);
  });

  test("an Echo heard before pairing is listed as unpaired, and can be named and renamed", async () => {
    await say(KITCHEN, "PlaySongIntent", { query: { value: "first" } });
    const before = await roomsNow();
    expect(before.rooms).toEqual([]);
    expect(before.unpaired).toMatchObject([{ skill: "music", deviceId: KITCHEN, room: null, nowPlaying: { videoId: id(1) } }]);

    const name = (room: unknown) => api.request("/alexa/devices", { method: "PATCH", body: JSON.stringify({ skill: "music", deviceId: KITCHEN, room }) });
    expect((await name("Kitchen")).status).toBe(200);
    expect((await api.request("/alexa/devices", { method: "PATCH", body: JSON.stringify({ skill: "music", deviceId: "unknown", room: "Den" }) })).status).toBe(404);
    expect((await api.request("/alexa/rooms/rename", { method: "POST", body: JSON.stringify({ from: "kitchen", to: "Galley" }) })).status).toBe(200);
    expect((await roomsNow()).rooms.map((room: any) => room.room)).toEqual(["Galley"]);
    expect((await name(null)).status).toBe(200);
    expect((await roomsNow()).unpaired).toHaveLength(1);
  });

  test("both skills on one Echo share its room, and the room shows whichever is playing", async () => {
    await api.request("/alexa/pairing", { method: "POST", body: JSON.stringify({ room: "Kitchen" }) });
    await say(KITCHEN, "PairDeviceIntent");
    await say("video-kitchen", "PairDeviceIntent", {}, settings.videoSkillId!);
    const view = await roomsNow();
    expect(view.rooms).toHaveLength(1);
    expect(view.rooms[0].devices.map((device: any) => device.skill).sort()).toEqual(["music", "video"]);
  });
});
