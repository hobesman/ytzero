import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { AsyncDatabaseClient } from "../databaseClient";
import { registerAlexaRoomRoutes } from "../routes/alexaRoomRoutes";
import { createAlexaRoomStore } from "./alexaRooms";
import { createAlexaRoomSettings, type AlexaRoomSettings } from "./alexaRoomSettings";
import { parseRoomVideoRequest, roomVideoCommand, spokenWords, type RoomVideoLookup } from "./alexaRoomVideo";
import { roomVideoPicks } from "./alexaRoomVideoPicks";
import type { AlexaVideo } from "./alexaVideoCatalog";
import { createHomeAssistantClient } from "./homeAssistant";

const NOW = Date.parse("2030-06-01T12:00:00Z");
const ENTITY = "media_player.kitchen_echo";
const CHANNEL = "UCBJycsmduvYEL83R_U4JriQ";
const video = (overrides: Partial<AlexaVideo> = {}): AlexaVideo => ({
  videoId: "abcdefghijk", title: "How I Fixed My Leaky Faucet (Part 2!) 🔧", channelId: CHANNEL, channelTitle: "This Old House",
  thumbnail: "", duration: 600, resumeAt: null, playable: true, isShort: false, ...overrides,
});
const lookup: RoomVideoLookup = {
  video: async (videoId) => videoId === "abcdefghijk" ? video() : videoId === "unplayable1" ? video({ playable: false }) : null,
  followed: async () => [{ channelId: CHANNEL, title: "Marques Brownlee & Friends" }],
};

describe("room video commands", () => {
  test("accepts a video, or a followed channel's latest or shuffle", () => {
    expect(parseRoomVideoRequest({ kind: "video", videoId: "abcdefghijk" })).toEqual({ kind: "video", videoId: "abcdefghijk" });
    expect(parseRoomVideoRequest({ kind: "latest", channelId: CHANNEL })).toEqual({ kind: "latest", channelId: CHANNEL });
    expect(parseRoomVideoRequest({ kind: "shuffle", channelId: "not a channel" })).toBeNull();
    expect(parseRoomVideoRequest({ kind: "video", videoId: "ask alexa to buy" })).toBeNull();
    expect(parseRoomVideoRequest(null)).toBeNull();
  });

  test("says a title the way the video skill matches it", () => {
    expect(spokenWords("How I Fixed My Leaky Faucet (Part 2!) 🔧")).toBe("how i fixed my leaky faucet part 2");
    expect(spokenWords("Rock & Roll's Best")).toBe("rock and rolls best");
    expect(spokenWords("one two three four", 2)).toBe("one two");
  });

  test("types a play, latest or shuffle for the video skill", async () => {
    expect(await roomVideoCommand("hoban tube", { kind: "video", videoId: "abcdefghijk" }, lookup))
      .toBe("ask hoban tube to play the video how i fixed my leaky faucet part 2 from this old house");
    expect(await roomVideoCommand("hoban tube", { kind: "latest", channelId: CHANNEL }, lookup))
      .toBe("ask hoban tube to play the latest from marques brownlee and friends");
    expect(await roomVideoCommand("hoban tube", { kind: "shuffle", channelId: CHANNEL }, lookup))
      .toBe("ask hoban tube to shuffle marques brownlee and friends");
    await expect(roomVideoCommand("hoban tube", { kind: "video", videoId: "missingvid1" }, lookup)).rejects.toThrow("doesn't know");
    await expect(roomVideoCommand("hoban tube", { kind: "video", videoId: "unplayable1" }, lookup)).rejects.toThrow("can't be played");
    await expect(roomVideoCommand("hoban tube", { kind: "latest", channelId: "UCxxxxxxxxxxxxxxxxxxxxxx" }, lookup)).rejects.toThrow("doesn't follow");
  });

  test("plays a search result YT Zero doesn't have by the title and channel the screen showed", async () => {
    expect(parseRoomVideoRequest({ kind: "video", videoId: "missingvid1", title: " Cats vs. Cucumbers ", channel: "Pet Lab" }))
      .toEqual({ kind: "video", videoId: "missingvid1", title: "Cats vs. Cucumbers", channel: "Pet Lab" });
    expect(parseRoomVideoRequest({ kind: "video", videoId: "missingvid1", title: "Only a title" }))
      .toEqual({ kind: "video", videoId: "missingvid1" });
    expect(await roomVideoCommand("hoban tube", { kind: "video", videoId: "missingvid1", title: "Cats vs. Cucumbers", channel: "Pet Lab" }, lookup))
      .toBe("ask hoban tube to play the video cats vs cucumbers from pet lab");
    // A video YT Zero knows is said as YT Zero has it, whatever the screen sent.
    expect(await roomVideoCommand("hoban tube", { kind: "video", videoId: "abcdefghijk", title: "Other", channel: "Other" }, lookup))
      .toBe("ask hoban tube to play the video how i fixed my leaky faucet part 2 from this old house");
  });
});

describe("POST /alexa/rooms/:room/video", () => {
  let settings: AlexaRoomSettings;
  let typed: string[];
  let api: Hono<{ Variables: { userId: number } }>;

  beforeEach(async () => {
    const db = new AsyncDatabaseClient("sqlite", ":memory:");
    await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY)");
    await db.exec("INSERT INTO users (id) VALUES (1)");
    await db.exec(readFileSync(new URL("../alexaSchema.sql", import.meta.url), "utf8"));
    settings = createAlexaRoomSettings(db);
    typed = [];
    const client = createHomeAssistantClient({ url: "http://ha.local:8123", token: "tok" }, async (_url, init) => {
      typed.push(JSON.parse(String(init?.body ?? "{}")).media_content_id);
      return Response.json([]);
    });
    api = new Hono<{ Variables: { userId: number } }>();
    api.use("*", async (context, next) => { context.set("userId", 1); await next(); });
    registerAlexaRoomRoutes(api, {
      currentUserId: (context) => context.get("userId"), rooms: createAlexaRoomStore(db), roomSettings: settings, isChild: async () => false, now: () => NOW,
      control: {
        homeAssistant: () => client, invocations: () => ({ music: "hoban music", video: "hoban tube", books: null, movies: null }),
        skills: () => ({ music: true, video: true, books: false, movies: false }), videoLookup: () => lookup,
      },
    });
  });

  const post = async (body: unknown) => {
    const response = await api.request("/alexa/rooms/Kitchen/video", { method: "POST", body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };

  test("types the video to the room's Echo", async () => {
    await settings.setEntity(1, "Kitchen", ENTITY, NOW);
    expect(await post({ kind: "latest", channelId: CHANNEL })).toEqual({
      status: 200, body: { room: "Kitchen", entity: ENTITY, via: "typed", command: "ask hoban tube to play the latest from marques brownlee and friends" },
    });
    expect(typed).toEqual(["ask hoban tube to play the latest from marques brownlee and friends"]);
  });

  test("notes the exact video for the room's Echo to take", async () => {
    await settings.setEntity(1, "Kitchen", ENTITY, NOW);
    expect((await post({ kind: "video", videoId: "missingvid1", title: "Cats vs. Cucumbers", channel: "Pet Lab" })).status).toBe(200);
    expect(roomVideoPicks.take(1, "kitchen", "cats vs cucumbers from pet lab")).toBe("missingvid1");
    expect(roomVideoPicks.take(1, "kitchen", "cats vs cucumbers from pet lab")).toBeNull();
  });

  test("notes the exact channel for latest and shuffle", async () => {
    await settings.setEntity(1, "Kitchen", ENTITY, NOW);
    expect((await post({ kind: "shuffle", channelId: CHANNEL })).status).toBe(200);
    expect(roomVideoPicks.take(1, "kitchen", "marques brownlee and friends", "latest")).toBeNull();
    expect(roomVideoPicks.take(1, "kitchen", "marques brownlee and friends", "shuffle")).toBe(CHANNEL);
  });

  test("refuses a bad request, a room without an Echo, and an unknown video", async () => {
    expect((await post({ kind: "video" })).status).toBe(400);
    expect((await post({ kind: "video", videoId: "abcdefghijk" })).status).toBe(409);
    await settings.setEntity(1, "Kitchen", ENTITY, NOW);
    expect((await post({ kind: "video", videoId: "missingvid1" })).status).toBe(404);
    expect(typed).toEqual([]);
  });
});
