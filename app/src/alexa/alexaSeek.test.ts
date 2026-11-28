import { describe, expect, test } from "bun:test";
import { AsyncDatabaseClient } from "../databaseClient";
import type { StoredMusicTrack } from "../music/musicCatalog";
import { alexaPlaylistLink } from "./alexaAudioLinks";
import { createAlexaBookSkill } from "./alexaBookSkill";
import { SINGLE_FILE_BOOK } from "./alexaBookTestBooks";
import type { NowPlaying } from "./alexaNowPlaying";
import { decodePlaybackToken, encodePlaybackToken } from "./alexaPlayback";
import { controlRoom, parseRoomAction, spokenPosition, type RoomControlDependencies } from "./alexaRoomControl";
import { createAlexaRoomHistory, ROOM_HISTORY_LIMIT } from "./alexaRoomHistory";
import type { AlexaDevice } from "./alexaRooms";
import { createAlexaSkill, type AlexaEnvelope } from "./alexaSkill";
import type { AlexaVideo } from "./alexaVideoCatalog";
import { createAlexaVideoSkill, encodeVideoToken } from "./alexaVideoSkill";
import { decodeShuffleToken, encodeShuffleToken } from "./alexaVideoShuffle";

/**
 * Jumping to a place, and going back: from the tablet's progress bar and
 * previous button, typed to the Echo as "jump to …" and "previous".
 */

const id = (n: number) => `vid${String(n).padStart(8, "0")}`;
type Play = { type: string; audioItem: { stream: { url: string; token: string; offsetInMilliseconds: number } } };
const directive = (response: { response: Record<string, unknown> }) => (response.response.directives as Play[] | undefined)?.[0];
const say = (name: string, slots: Record<string, string> = {}, player?: { token: string; offsetInMilliseconds?: number }): AlexaEnvelope => ({
  context: { AudioPlayer: player },
  request: { type: "IntentRequest", intent: { name, slots: Object.fromEntries(Object.entries(slots).map(([key, value]) => [key, { value }])) } },
});

const track = (n: number): StoredMusicTrack => ({
  videoId: id(n), title: `Song ${n}`, artist: "Artist", artistId: null, album: null, duration: 200,
  thumbnail: "https://i.ytimg.com/x.jpg", isTopic: true, songKey: `song-${n}`,
} as StoredMusicTrack);

function musicSkill() {
  return createAlexaSkill({
    client: { searchSongs: async () => [track(1)], searchAll: async () => ({ albums: [], artists: [] }) } as never,
    stations: { next: async () => [track(9)] },
    prepare: () => {},
    audioLink: (videoId, userId, start) => start
      ? alexaPlaylistLink("https://yt.example.com", "s".repeat(40), videoId, userId, 0, start, "music")
      : `https://yt.example.com/alexa/audio/${videoId}?u=${userId}`,
    // Playlist segments of 10 seconds.
    streamStart: async (_userId, _videoId, offset) => Math.floor(offset / 10) * 10,
    recordPlay: async () => {},
    findTrack: async (videoId) => ({ ...track(Number(videoId.slice(3))), videoId }),
    saveTracks: async (tracks) => tracks as StoredMusicTrack[],
  });
}

describe("music: seeking and previous", () => {
  const token = encodePlaybackToken({ seed: { kind: "mix" }, videoId: id(3), served: [id(1), id(2)], skipped: [], failures: 0 });

  test("jumping plays a playlist starting at the segment holding the place, since the Echo can't start part way into the file", async () => {
    const played = directive(await musicSkill().handle(7, say("SeekToIntent", { position: "PT1M35S" }, { token, offsetInMilliseconds: 5_000 })))!;
    expect(played.audioItem.stream.offsetInMilliseconds).toBe(90_000);
    expect(played.audioItem.stream.url).toContain(`/alexa/audio/${id(3)}/index.m3u8?`);
    expect(played.audioItem.stream.url).toContain("&t=90");
    expect(decodePlaybackToken(played.audioItem.stream.token)?.videoId).toBe(id(3));
  });

  test("skips move from the place the Echo reports; back to the start plays the plain file", async () => {
    const forward = directive(await musicSkill().handle(7, say("SkipForwardIntent", { duration: "PT30S" }, { token, offsetInMilliseconds: 41_000 })))!;
    expect(forward.audioItem.stream.offsetInMilliseconds).toBe(70_000);
    const back = directive(await musicSkill().handle(7, say("SkipBackIntent", {}, { token, offsetInMilliseconds: 10_000 })))!;
    expect(back.audioItem.stream.offsetInMilliseconds).toBe(0);
    expect(back.audioItem.stream.url).not.toContain("index.m3u8");
  });

  test("previous plays the song before, and with none starts this one over", async () => {
    const before = directive(await musicSkill().handle(7, say("AMAZON.PreviousIntent", {}, { token, offsetInMilliseconds: 50_000 })))!;
    const state = decodePlaybackToken(before.audioItem.stream.token)!;
    expect(state.videoId).toBe(id(2));
    expect(state.served).toEqual([id(1)]);
    const first = encodePlaybackToken({ seed: { kind: "mix" }, videoId: id(1), served: [], skipped: [], failures: 0 });
    const over = directive(await musicSkill().handle(7, { request: { type: "PlaybackController.PreviousCommandIssued" }, context: { AudioPlayer: { token: first, offsetInMilliseconds: 50_000 } } }))!;
    expect(decodePlaybackToken(over.audioItem.stream.token)?.videoId).toBe(id(1));
    expect(over.audioItem.stream.offsetInMilliseconds).toBe(0);
  });
});

const video = (n: number): AlexaVideo => ({
  videoId: id(n), title: `Video ${n}`, channelId: "UC_rober", channelTitle: "Mark Rober", thumbnail: "", duration: 600, resumeAt: null, playable: true, isShort: false,
});

function videoSkill() {
  const videos = [video(1), video(2), video(3)];
  return createAlexaVideoSkill({
    followedChannels: async () => [], channelVideos: async () => videos,
    findVideo: async (_userId, videoId) => videos.find((item) => item.videoId === videoId) ?? null,
    search: async () => [], importVideo: async () => {},
    audioLink: (videoId, _userId, start) => `https://yt.example.com/alexa/video-audio/${videoId}/index.m3u8?t=${start ?? 0}`,
    prepare: () => {}, recordStarted: async () => {}, recordProgress: async () => {}, recordFinished: async () => {},
  });
}

describe("video: seeking and previous", () => {
  test("jumps to a place, kept within the video", async () => {
    const token = encodeVideoToken(id(1));
    expect(directive(await videoSkill().handle(7, say("SeekToIntent", { position: "PT5M" }, { token, offsetInMilliseconds: 0 })))?.audioItem.stream.offsetInMilliseconds).toBe(300_000);
    expect(directive(await videoSkill().handle(7, say("SeekToIntent", { position: "PT2H" }, { token, offsetInMilliseconds: 0 })))?.audioItem.stream.offsetInMilliseconds).toBe(599_000);
  });

  test("previous in a shuffle plays the video before; otherwise this one starts over", async () => {
    const shuffled = encodeShuffleToken({ channelId: "UC_rober", videoId: id(3), played: [id(1), id(2)] });
    const before = directive(await videoSkill().handle(7, say("AMAZON.PreviousIntent", {}, { token: shuffled, offsetInMilliseconds: 90_000 })))!;
    expect(decodeShuffleToken(before.audioItem.stream.token)).toEqual({ channelId: "UC_rober", videoId: id(2), played: [id(1)] });
    expect(before.audioItem.stream.offsetInMilliseconds).toBe(0);
    const single = directive(await videoSkill().handle(7, say("AMAZON.PreviousIntent", {}, { token: encodeVideoToken(id(1)), offsetInMilliseconds: 90_000 })))!;
    expect(single.audioItem.stream.token).toBe(encodeVideoToken(id(1)));
    expect(single.audioItem.stream.offsetInMilliseconds).toBe(0);
  });
});

test("books: jumping goes to a place in the whole book", async () => {
  const api = {
    book: async () => SINGLE_FILE_BOOK, progress: async () => null, saveProgress: async () => {}, inProgress: async () => [],
    search: async () => [], libraryBooks: async () => ({ books: [], total: 0 }), bookLibraries: async () => [], allProgress: async () => [],
  };
  const skill = createAlexaBookSkill({
    books: () => api as never,
    audioLink: (bookId, fileIndex, _userId, start) => `https://yt.example.com/alexa/book-audio/${bookId}/${fileIndex}?t=${start}`,
    coverLink: () => "",
  });
  const played = directive(await skill.handle(1, say("SeekToIntent", { position: "PT2H10M" }, { token: "hb1.li_single.0", offsetInMilliseconds: 0 })))!;
  expect(played.audioItem.stream.offsetInMilliseconds).toBe(7_800_000);
  expect(played.audioItem.stream.url).toContain("t=7800");
});

describe("room control: seek and skip", () => {
  const record = (token: string): NowPlaying => ({
    token, videoId: id(1), title: "Song", artist: "", art: "", durationMs: 200_000, state: "playing", offsetMs: 0, startedAt: null, nextToken: null, updatedAt: "2030-01-01T00:00:00Z",
  });
  function control(devices: AlexaDevice[], seen: Record<string, unknown> | null = null) {
    const typed: string[] = [];
    const services: [string, Record<string, unknown> | undefined][] = [];
    const dependencies = {
      homeAssistant: {
        typeCommand: async (_entity: string, command: string) => { typed.push(command); },
        service: async (name: string, _entity: string, data?: Record<string, unknown>) => { services.push([name, data]); },
        state: async () => seen ?? { entity_id: "media_player.kitchen", state: "idle", attributes: {} },
      },
      invocations: { music: "hoban music", video: "hoban tube", books: "hoban books", movies: null },
      rooms: { devices: async () => devices },
      settings: { entity: async () => "media_player.kitchen", spelling: async () => "Kitchen" },
      skills: { music: true, video: true, books: true, movies: false },
      now: () => Date.parse("2030-01-01T00:00:10Z"),
    } as unknown as RoomControlDependencies;
    return { dependencies, typed, services };
  }
  const device = (skill: AlexaDevice["skill"]): AlexaDevice => ({ skill, deviceId: "d", room: "Kitchen", pairedAt: null, lastSeenAt: "", nowPlaying: record("t"), pending: null });

  test("reads a seek as a place in seconds", () => {
    expect(parseRoomAction({ action: "seek", seconds: 95.4 })).toEqual({ action: "seek", seconds: 95 });
    expect(parseRoomAction({ action: "seek", seconds: -1 })).toBeNull();
    expect(spokenPosition(0)).toBe("0 seconds");
    expect(spokenPosition(3725)).toBe("1 hour 2 minutes 5 seconds");
    expect(spokenPosition(120)).toBe("2 minutes");
  });

  test("types the jump to whichever of our skills is playing", async () => {
    const { dependencies, typed } = control([device("video")]);
    await controlRoom(dependencies, 1, "kitchen", { action: "seek", seconds: 125 });
    await controlRoom(dependencies, 1, "kitchen", { action: "skip", seconds: -30 });
    await controlRoom(dependencies, 1, "kitchen", { action: "seek", seconds: 0 });
    expect(typed).toEqual(["ask hoban tube to jump to 2 minutes 5 seconds", "ask hoban tube to go back 30 seconds", "ask hoban tube to start over"]);
  });

  test("moves what Home Assistant plays with its own seek, and says so when the Echo can't", async () => {
    const amazon = { entity_id: "media_player.kitchen", state: "playing", attributes: { media_title: "Song", media_position: 10, supported_features: 2 } };
    const { dependencies, services } = control([], amazon);
    await controlRoom(dependencies, 1, "kitchen", { action: "seek", seconds: 60 });
    expect(services).toEqual([["media_seek", { seek_position: 60 }]]);
    const { dependencies: noSeek } = control([], { ...amazon, attributes: { ...amazon.attributes, supported_features: 0 } });
    await expect(controlRoom(noSeek, 1, "kitchen", { action: "seek", seconds: 60 })).rejects.toThrow("can't jump");
  });
});

test("room history keeps each room's latest plays, newest first, one row per item", async () => {
  const db = new AsyncDatabaseClient("sqlite", ":memory:");
  await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY)");
  await db.exec("INSERT INTO users (id) VALUES (1)");
  await db.exec("CREATE TABLE alexa_room_history (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, room_key TEXT NOT NULL, skill TEXT NOT NULL, item_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', artist TEXT NOT NULL DEFAULT '', art TEXT NOT NULL DEFAULT '', played_at TEXT NOT NULL, PRIMARY KEY (user_id, room_key, skill, item_id))");
  const history = createAlexaRoomHistory(db);
  const base = Date.parse("2030-01-01T00:00:00Z");
  for (let n = 0; n < ROOM_HISTORY_LIMIT + 5; n++) {
    await history.record(1, "Kitchen", { skill: "music", itemId: id(n), title: `Song ${n}`, artist: "A", art: "" }, base + n * 1000);
  }
  await history.record(1, "kitchen", { skill: "music", itemId: id(10), title: "Song 10", artist: "A", art: "" }, base + 100_000);
  await history.record(1, "Hall", { skill: "music", itemId: id(99), title: "Elsewhere", artist: "A", art: "" }, base);
  const kitchen = await history.list(1, "KITCHEN", "music");
  expect(kitchen).toHaveLength(ROOM_HISTORY_LIMIT);
  expect(kitchen[0]!.itemId).toBe(id(10));
  expect(kitchen.some((item) => item.itemId === id(99))).toBe(false);
  expect(await history.list(1, "Kitchen", "video")).toEqual([]);
});
