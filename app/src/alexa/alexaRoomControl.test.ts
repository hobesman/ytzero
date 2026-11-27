import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { AsyncDatabaseClient } from "../databaseClient";
import type { StoredMusicTrack } from "../music/musicCatalog";
import type { StationSeed } from "../music/musicStation";
import { createAlexaRouter } from "../routes/alexaRoutes";
import { registerAlexaRoomRoutes } from "../routes/alexaRoomRoutes";
import type { AlexaConfig } from "./alexaConfig";
import { decodePlaybackToken, encodePlaybackToken } from "./alexaPlayback";
import { createAlexaRoomStore, type AlexaRoomStore } from "./alexaRooms";
import { createAlexaRoomSettings, type AlexaRoomSettings } from "./alexaRoomSettings";
import {
  alexaInvocations, createHomeAssistantClient, homeAssistantConfig, homeAssistantReport, type HomeAssistantState,
} from "./homeAssistant";

const NOW = Date.parse("2030-06-01T12:00:00Z");
const id = (n: number) => `vid${String(n).padStart(8, "0")}`;
const KITCHEN = "amzn1.ask.device.KITCHEN";
const KITCHEN_VIDEO = "amzn1.ask.device.KITCHEN-VIDEO";
const ENTITY = "media_player.kitchen_echo";
const settings: AlexaConfig = {
  musicSkillId: "amzn1.ask.skill.music", videoSkillId: "amzn1.ask.skill.video", profile: "1", secret: "s".repeat(40), publicUrl: "https://yt.example.com",
};
const track = (videoId: string): StoredMusicTrack => ({
  videoId, title: `Song ${videoId}`, artist: "Artist", artistId: null, album: null, duration: 200,
  thumbnail: "https://i.ytimg.com/x.jpg", isTopic: true, songKey: videoId,
} as StoredMusicTrack);

describe("home assistant config", () => {
  test("is off until both the address and the token are set", () => {
    expect(homeAssistantConfig({})).toHaveProperty("disabled");
    expect(homeAssistantConfig({ YTZERO_HOME_ASSISTANT_URL: "http://ha.local:8123/" })).toEqual({ disabled: "YTZERO_HOME_ASSISTANT_TOKEN is not set" });
    expect(homeAssistantConfig({ YTZERO_HOME_ASSISTANT_URL: "ftp://ha", YTZERO_HOME_ASSISTANT_TOKEN: "t" })).toHaveProperty("disabled");
    expect(homeAssistantConfig({ YTZERO_HOME_ASSISTANT_URL: "\"http://ha.local:8123/\"", YTZERO_HOME_ASSISTANT_TOKEN: " tok " }))
      .toEqual({ url: "http://ha.local:8123", token: "tok" });
  });

  test("reads the skills' invocation names as Alexa hears them", () => {
    expect(alexaInvocations({ YTZERO_ALEXA_MUSIC_INVOCATION: "Hoban  Music" })).toEqual({ music: "hoban music", video: null });
  });
});

describe("home assistant client", () => {
  test("types a command with the token, and names a refused token", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let status = 200;
    const client = createHomeAssistantClient({ url: "http://ha.local:8123", token: "tok" }, async (url, init) => {
      calls.push({ url, init });
      return new Response("[]", { status });
    });
    await client.typeCommand(ENTITY, "ask hoban music to pair");
    expect(calls[0]!.url).toBe("http://ha.local:8123/api/services/media_player/play_media");
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ entity_id: ENTITY, media_content_type: "custom", media_content_id: "ask hoban music to pair" });
    status = 401;
    await expect(client.state(ENTITY)).rejects.toThrow("refused the access token");
    await expect(client.state("light.kitchen")).rejects.toThrow("not a media_player");
  });

  test("reports position carried forward while playing, and only public art", () => {
    const state: HomeAssistantState = {
      entity_id: ENTITY, state: "playing", last_changed: "2030-06-01T11:59:00Z",
      attributes: {
        friendly_name: "Kitchen Echo", media_title: "Song", media_artist: "Band", media_duration: 200, media_position: 30,
        media_position_updated_at: "2030-06-01T11:59:50Z", entity_picture: "https://m.media-amazon.com/x.jpg", source: "Local Speaker", volume_level: 0.4,
      },
    };
    expect(homeAssistantReport(state, NOW)).toMatchObject({ title: "Song", artist: "Band", positionMs: 40_000, durationMs: 200_000, art: "https://m.media-amazon.com/x.jpg", source: "Local Speaker", volume: 0.4 });
    expect(homeAssistantReport({ ...state, state: "paused" }, NOW).positionMs).toBe(30_000);
    expect(homeAssistantReport({ ...state, attributes: { ...state.attributes, entity_picture: "/api/media_player_proxy/x?token=secret" } }, NOW).art).toBeNull();
  });
});

describe("playback token", () => {
  test("carries a queue's ID and place, and stays under Alexa's limit with full history", () => {
    const state = {
      seed: { kind: "track", videoId: id(1) } as StationSeed, videoId: id(2),
      served: Array.from({ length: 40 }, (_, n) => id(n)), skipped: Array.from({ length: 20 }, (_, n) => id(n)), failures: 2, queue: { id: "abcdEFGH", index: 499 },
    };
    const token = encodePlaybackToken(state);
    expect(token.length).toBeLessThan(1024);
    expect(decodePlaybackToken(token)?.queue).toEqual({ id: "abcdEFGH", index: 499 });
    expect(decodePlaybackToken(encodePlaybackToken({ ...state, queue: undefined }))).not.toHaveProperty("queue");
  });
});

/** A fake Home Assistant: entity states, and every service called. */
function fakeHomeAssistant() {
  const states = new Map<string, HomeAssistantState>([[ENTITY, { entity_id: ENTITY, state: "idle", attributes: { friendly_name: "Kitchen Echo", last_called: false } }]]);
  states.set("media_player.living_room_tv", { entity_id: "media_player.living_room_tv", state: "off", attributes: { friendly_name: "TV" } });
  const services: { service: string; data: Record<string, unknown> }[] = [];
  const failing = new Set<string>();
  const onCommand: ((command: string) => Promise<void>)[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/api/states") return Response.json([...states.values()]);
    if (path.startsWith("/api/states/")) {
      const state = states.get(path.slice("/api/states/".length));
      return state ? Response.json(state) : new Response("not found", { status: 404 });
    }
    const service = path.replace("/api/services/media_player/", "");
    const data = JSON.parse(String(init?.body ?? "{}"));
    if (failing.has(service)) return new Response("error", { status: 500 });
    services.push({ service, data });
    if (service === "play_media") for (const handler of onCommand) await handler(data.media_content_id);
    return Response.json([]);
  };
  return { client: createHomeAssistantClient({ url: "http://ha.local:8123", token: "tok" }, fetcher), states, services, failing, onCommand };
}

describe("room controls through home assistant", () => {
  let rooms: AlexaRoomStore;
  let roomSettings: AlexaRoomSettings;
  let clock = NOW;
  let ha: ReturnType<typeof fakeHomeAssistant>;
  let alexa: Hono;
  let api: Hono<{ Variables: { userId: number } }>;
  const catalog = new Set([id(1), id(2), id(3)]);
  const stationSeeds: StationSeed[] = [];

  beforeEach(async () => {
    const db = new AsyncDatabaseClient("sqlite", ":memory:");
    await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY)");
    await db.exec("INSERT INTO users (id) VALUES (1)");
    await db.exec(readFileSync(new URL("../alexaSchema.sql", import.meta.url), "utf8"));
    rooms = createAlexaRoomStore(db);
    roomSettings = createAlexaRoomSettings(db);
    clock = NOW;
    ha = fakeHomeAssistant();
    stationSeeds.length = 0;
    alexa = createAlexaRouter({
      config: () => settings, verifier: { check: async () => null }, resolveProfile: async () => 1, isChild: async () => false,
      rooms, roomSettings, describeStream: async () => null, now: () => clock,
      skill: {
        client: { searchSongs: async () => [], searchAll: async () => ({ albums: [], artists: [] }) },
        stations: { next: async (_userId, seed) => { stationSeeds.push(seed); return [track(seed.kind === "album" ? id(7) : id(9))]; } },
        prepare: () => {},
        audioLink: (videoId, userId) => `https://yt.example.com/alexa/audio/${videoId}?u=${userId}`,
        recordPlay: async () => {},
        findTrack: async (videoId) => catalog.has(videoId) || videoId === id(7) || videoId === id(9) ? track(videoId) : null,
        saveTracks: async (tracks) => tracks as StoredMusicTrack[],
      },
    });
    api = new Hono<{ Variables: { userId: number } }>();
    api.use("*", async (context, next) => { context.set("userId", 1); await next(); });
    registerAlexaRoomRoutes(api, {
      currentUserId: (context) => context.get("userId"), rooms, roomSettings, isChild: async () => false, now: () => clock,
      control: {
        homeAssistant: () => ha.client,
        invocations: () => ({ music: "hoban music", video: "hoban tube" }),
        skills: () => ({ music: true, video: true }),
        knownSongs: async (ids) => new Set(ids.filter((videoId) => catalog.has(videoId))),
        sleep: async (ms) => { clock += ms; },
        pairWaitMs: 5000,
      },
    });
  });

  const send = async (deviceId: string, request: Record<string, unknown>, skillId = settings.musicSkillId!) => {
    const body = { context: { System: { application: { applicationId: skillId }, device: { deviceId } } }, request: { timestamp: new Date(clock).toISOString(), ...request } };
    return (await alexa.request("/", { method: "POST", body: JSON.stringify(body) })).json() as Promise<{ response: Record<string, any> }>;
  };
  const say = (deviceId: string, name: string, skillId?: string) => send(deviceId, { type: "IntentRequest", intent: { name, slots: {} } }, skillId);
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await api.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
  };
  const setEntity = () => call("PUT", "/alexa/rooms/Kitchen/entity", { entity: ENTITY });
  // The Echo answers a typed command as if it were spoken: each skill hears its own invocation.
  const echoHearsCommands = () => ha.onCommand.push(async (command) => {
    if (command === "ask hoban music to pair") await say(KITCHEN, "PairDeviceIntent");
    if (command === "ask hoban tube to pair") await say(KITCHEN_VIDEO, "PairDeviceIntent", settings.videoSkillId!);
    if (command === "ask hoban music to play my queue") await say(KITCHEN, "PlayQueueIntent");
  });
  const startPlaying = async (token: string) => send(KITCHEN, { type: "AudioPlayer.PlaybackStarted", token, offsetInMilliseconds: 0 });

  test("lists Home Assistant's Alexa media players and maps a room to one that exists", async () => {
    const listed = await call("GET", "/alexa/home-assistant");
    expect(listed.body).toMatchObject({ enabled: true, invocations: { music: "hoban music" }, mediaPlayers: [{ entity: ENTITY, name: "Kitchen Echo", alexa: true }] });
    expect((await call("GET", "/alexa/home-assistant?all=1")).body.mediaPlayers).toHaveLength(2);
    expect((await call("PUT", "/alexa/rooms/Kitchen/entity", { entity: "media_player.nowhere" })).status).toBe(400);
    expect((await call("PUT", "/alexa/rooms/Kitchen/entity", { entity: "light.kitchen" })).status).toBe(400);
    expect((await setEntity()).body).toEqual({ room: "Kitchen", entity: ENTITY });
    // A room with an Echo entity shows before any device is paired.
    expect((await call("GET", "/alexa/rooms")).body.rooms).toMatchObject([{ room: "Kitchen", devices: [], homeAssistant: { entity: ENTITY, state: "idle" } }]);
  });

  test("pairs the room's Echo with both skills in one call", async () => {
    await setEntity();
    echoHearsCommands();
    const paired = await call("POST", "/alexa/rooms/kitchen/pair");
    expect(paired.body).toEqual({ room: "Kitchen", entity: ENTITY, paired: ["music", "video"], failed: [] });
    expect(ha.services.map((item) => item.data.media_content_id)).toEqual(["ask hoban music to pair", "ask hoban tube to pair"]);
    expect(await rooms.room(1, "music", KITCHEN)).toBe("Kitchen");
    expect(await rooms.room(1, "video", KITCHEN_VIDEO)).toBe("Kitchen");
    expect(await rooms.pairing(1, clock)).toBeNull();
  });

  test("reports a skill whose Echo never answered", async () => {
    await setEntity();
    ha.onCommand.push(async (command) => { if (command === "ask hoban music to pair") await say(KITCHEN, "PairDeviceIntent"); });
    const paired = await call("POST", "/alexa/rooms/Kitchen/pair");
    expect(paired.body.paired).toEqual(["music"]);
    expect(paired.body.failed).toMatchObject([{ skill: "video" }]);
  });

  test("pairs the skills it can name, and says which invocation is missing", async () => {
    const { pairRoom } = await import("./alexaRoomControl");
    await setEntity();
    echoHearsCommands();
    const result = await pairRoom({
      homeAssistant: ha.client, invocations: { music: "hoban music", video: null }, rooms, settings: roomSettings,
      skills: { music: true, video: true }, now: () => clock, sleep: async (ms) => { clock += ms; },
    }, 1, "Kitchen", 5000);
    expect(result.paired).toEqual(["music"]);
    expect(result.failed).toEqual([{ skill: "video", reason: "YTZERO_ALEXA_VIDEO_INVOCATION isn't set" }]);
  });

  test("controls our skill with typed commands and Amazon Music with Home Assistant's services", async () => {
    await setEntity();
    await rooms.setRoom(1, "music", KITCHEN, "Kitchen", clock);
    expect((await call("POST", "/alexa/rooms/Kitchen/control", { action: "jump" })).status).toBe(400);

    // Our skill playing: Home Assistant shows the Echo idle, so the Echo gets typed commands.
    const played = await say(KITCHEN, "PlayMixIntent");
    await startPlaying(played.response.directives[0].audioItem.stream.token);
    expect((await call("POST", "/alexa/rooms/Kitchen/control", { action: "pause" })).body).toMatchObject({ via: "typed", command: "pause" });
    expect((await call("POST", "/alexa/rooms/Kitchen/control", { action: "next" })).body).toMatchObject({ via: "typed", command: "next" });
    await send(KITCHEN, { type: "AudioPlayer.PlaybackStopped", token: played.response.directives[0].audioItem.stream.token, offsetInMilliseconds: 5000 });
    expect((await call("POST", "/alexa/rooms/Kitchen/control", { action: "resume" })).body).toMatchObject({ via: "typed", command: "ask hoban music to resume" });

    // Amazon Music playing, which Home Assistant sees.
    clock += 60_000;
    ha.states.set(ENTITY, { entity_id: ENTITY, state: "playing", last_changed: new Date(clock).toISOString(), attributes: { media_title: "Amazon Song", media_artist: "Someone", last_called: true } });
    expect((await call("POST", "/alexa/rooms/Kitchen/control", { action: "pause" })).body).toMatchObject({ via: "home-assistant", service: "media_pause" });
    expect((await call("POST", "/alexa/rooms/Kitchen/control", { action: "next" })).body).toMatchObject({ via: "home-assistant", service: "media_next_track" });
    ha.states.set(ENTITY, { ...ha.states.get(ENTITY)!, state: "paused" });
    expect((await call("POST", "/alexa/rooms/Kitchen/control", { action: "resume" })).body).toMatchObject({ via: "home-assistant", service: "media_play" });

    expect((await call("POST", "/alexa/rooms/Kitchen/control", { action: "volume", volume: 4 })).body).toMatchObject({ via: "home-assistant", service: "volume_set" });
    expect(ha.services.at(-1)!.data).toEqual({ entity_id: ENTITY, volume_level: 0.4 });
    ha.failing.add("volume_set");
    expect((await call("POST", "/alexa/rooms/Kitchen/control", { action: "volume", volume: 5 })).body).toMatchObject({ via: "typed", command: "volume 5" });
  });

  test("a room without an entity, or without Home Assistant, says so", async () => {
    expect((await call("POST", "/alexa/rooms/Den/control", { action: "pause" })).status).toBe(409);
  });

  test("shows Amazon Music from Home Assistant, until our skill plays", async () => {
    await setEntity();
    await rooms.setRoom(1, "music", KITCHEN, "Kitchen", clock);
    ha.states.set(ENTITY, { entity_id: ENTITY, state: "playing", attributes: { media_title: "Amazon Song", media_artist: "Someone", source: "Local Speaker", last_called: true } });
    let kitchen = (await call("GET", "/alexa/rooms")).body.rooms[0];
    expect(kitchen.current).toMatchObject({ origin: "home-assistant", title: "Amazon Song", artist: "Someone", source: "Local Speaker" });
    expect(kitchen.homeAssistant).toMatchObject({ entity: ENTITY, state: "playing", title: "Amazon Song" });

    const played = await say(KITCHEN, "PlayMixIntent");
    await startPlaying(played.response.directives[0].audioItem.stream.token);
    kitchen = (await call("GET", "/alexa/rooms")).body.rooms[0];
    expect(kitchen.current).toMatchObject({ origin: "music", title: `Song ${id(9)}`, state: "playing" });
  });

  test("queues songs for a room, starts them in one call, and runs into a station after", async () => {
    await setEntity();
    await rooms.setRoom(1, "music", KITCHEN, "Kitchen", clock);
    echoHearsCommands();
    expect((await call("PUT", "/alexa/rooms/Kitchen/queue", { videoIds: [id(1), id(8)] })).body).toMatchObject({ unknown: [id(8)] });
    expect((await call("PUT", "/alexa/rooms/Kitchen/queue", {})).status).toBe(400);

    const saved = await call("PUT", "/alexa/rooms/Kitchen/queue", { videoIds: [id(1), id(2), id(3)], title: "Dinner", play: true });
    expect(saved.body).toMatchObject({ queue: { title: "Dinner", videoIds: [id(1), id(2), id(3)] }, started: { via: "typed", command: "ask hoban music to play my queue" } });
    // The Echo heard the command; the skill sent the queue's first song, pending until it starts.
    const view = (await call("GET", "/alexa/rooms")).body.rooms[0];
    expect(view.pending).toMatchObject({ videoId: id(1) });

    const first = await say(KITCHEN, "PlayQueueIntent");
    expect(first.response.outputSpeech.text).toBe("Playing Dinner.");
    let token = first.response.directives[0].audioItem.stream.token;
    expect(decodePlaybackToken(token)).toMatchObject({ videoId: id(1), queue: { id: saved.body.queue.queueId, index: 0 } });
    const played: string[] = [id(1)];
    for (let step = 0; step < 3; step += 1) {
      const next = await send(KITCHEN, { type: "AudioPlayer.PlaybackNearlyFinished", token, offsetInMilliseconds: 190_000 });
      token = next.response.directives[0].audioItem.stream.token;
      played.push(decodePlaybackToken(token)!.videoId);
    }
    // Then a station like the queue's last song.
    expect(played).toEqual([id(1), id(2), id(3), id(9)]);
    expect(stationSeeds.at(-1)).toEqual({ kind: "track", videoId: id(3) });
    expect(decodePlaybackToken(token)).not.toHaveProperty("queue");
  });

  test("a station queue plays its seed, and an unpaired Echo or empty room says why", async () => {
    await setEntity();
    expect((await say(KITCHEN, "PlayQueueIntent")).response.outputSpeech.text).toContain("isn't paired with a room");
    await rooms.setRoom(1, "music", KITCHEN, "Kitchen", clock);
    expect((await say(KITCHEN, "PlayQueueIntent")).response.outputSpeech.text).toBe("There's nothing queued for the Kitchen.");
    expect((await call("POST", "/alexa/rooms/Kitchen/queue/play")).status).toBe(404);

    const seed = { kind: "album", browseId: "MPREb_abcdefghijk" };
    expect((await call("PUT", "/alexa/rooms/kitchen/queue", { seed: { kind: "nope" } })).status).toBe(400);
    expect((await call("PUT", "/alexa/rooms/kitchen/queue", { seed, title: "OK Computer" })).status).toBe(200);
    expect((await call("GET", "/alexa/rooms/Kitchen/queue")).body.queue).toMatchObject({ room: "Kitchen", seed, title: "OK Computer" });
    const started = await say(KITCHEN, "PlayQueueIntent");
    expect(started.response.outputSpeech.text).toBe("Playing OK Computer.");
    expect(decodePlaybackToken(started.response.directives[0].audioItem.stream.token)).toMatchObject({ seed, videoId: id(7) });
    expect((await call("POST", "/alexa/rooms/Kitchen/queue/play")).body).toMatchObject({ command: "ask hoban music to play my queue" });
  });

  test("a queue replaced while playing hands over to the station, and renaming keeps the room's settings", async () => {
    await setEntity();
    await rooms.setRoom(1, "music", KITCHEN, "Kitchen", clock);
    await call("PUT", "/alexa/rooms/Kitchen/queue", { videoIds: [id(1), id(2)] });
    const token = (await say(KITCHEN, "PlayQueueIntent")).response.directives[0].audioItem.stream.token;
    await call("PUT", "/alexa/rooms/Kitchen/queue", { videoIds: [id(3)] });
    const next = await send(KITCHEN, { type: "AudioPlayer.PlaybackNearlyFinished", token, offsetInMilliseconds: 190_000 });
    expect(decodePlaybackToken(next.response.directives[0].audioItem.stream.token)?.videoId).toBe(id(9));

    expect((await call("POST", "/alexa/rooms/rename", { from: "Kitchen", to: "Galley" })).status).toBe(200);
    expect(await roomSettings.entity(1, "galley")).toBe(ENTITY);
    expect((await roomSettings.queue(1, "Galley"))?.videoIds).toEqual([id(3)]);
    expect(await roomSettings.entity(1, "Kitchen")).toBeNull();
  });
});
