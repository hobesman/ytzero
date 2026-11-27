import { describe, expect, test } from "bun:test";
import type { AlexaRoom, AlexaRooms, RoomCurrent } from "./roomApi";
import {
  CONTROL_TIMEOUT_MS, IDLE_AFTER_MS, clockDuration, controlConfirmed, findRoom, isIdle, livePosition, pollDelay, roomDisplay, roomFingerprint,
  roomArtSource, roomLyricsSong, roomPath, roomSource, roomVolume, settleControl, storedRoom, type PendingControl,
} from "./roomState";

const song: RoomCurrent = {
  origin: "music", state: "playing", title: "Harvest Moon", artist: "Neil Young", art: "https://i.ytimg.com/a.jpg",
  durationMs: 300_000, positionMs: 60_000, source: null,
};
const kitchen = (overrides: Partial<AlexaRoom> = {}): AlexaRoom => ({
  room: "Kitchen", nowPlaying: null, pending: null, homeAssistant: null, current: song, devices: [], ...overrides,
});
const pending = { skill: "music" as const, videoId: "abcdefghijk", title: "OK Computer", artist: "Radiohead", art: "", durationMs: null, requestedAt: "2030-06-01T12:00:05Z" };
const control = (action: PendingControl["action"], room: AlexaRoom, extra: Partial<PendingControl> = {}): PendingControl =>
  ({ action, sentAt: 1_000, before: roomFingerprint(room), ...extra });

describe("progress", () => {
  test("moves on by the time since the answer arrived while playing", () => {
    expect(livePosition(song, 10_000, 14_500)).toEqual({ positionMs: 64_500, durationMs: 300_000 });
  });

  test("stands still while paused, and stops at the end", () => {
    expect(livePosition({ ...song, state: "paused" }, 10_000, 99_000)?.positionMs).toBe(60_000);
    expect(livePosition(song, 0, 10_000_000)?.positionMs).toBe(300_000);
  });

  test("has no bar without a position, and no end without a length", () => {
    expect(livePosition({ ...song, positionMs: null }, 0, 0)).toBe(null);
    expect(livePosition(null, 0, 0)).toBe(null);
    expect(livePosition({ ...song, durationMs: null }, 0, 1_000)).toEqual({ positionMs: 61_000, durationMs: null });
  });

  test("writes times as a clock", () => {
    expect(clockDuration(187_400)).toBe("3:07");
    expect(clockDuration(3_765_000)).toBe("1:02:45");
    expect(clockDuration(-5)).toBe("0:00");
  });
});

describe("which source to show", () => {
  test("names our skills, and Home Assistant's input for anything else", () => {
    expect(roomSource("music")).toEqual({ kind: "music" });
    expect(roomSource("video")).toEqual({ kind: "video" });
    expect(roomSource("home-assistant", "Spotify")).toEqual({ kind: "home-assistant", source: "Spotify" });
    expect(roomSource("home-assistant", "Local Speaker")).toEqual({ kind: "home-assistant", source: null });
    expect(roomSource("home-assistant")).toEqual({ kind: "home-assistant", source: null });
  });

  test("shows a play that hasn't started as starting, ahead of what played before", () => {
    expect(roomDisplay(kitchen({ pending }))).toEqual({ kind: "starting", item: pending });
    expect(roomDisplay(kitchen()).kind).toBe("playing");
    expect(roomDisplay(kitchen({ current: { ...song, state: "paused" } })).kind).toBe("paused");
  });

  test("proxies YouTube art, and loads other services' art from its own https address", () => {
    expect(roomArtSource("https://i.ytimg.com/vi/x/hq.jpg")).toBe("/api/img?u=https%3A%2F%2Fi.ytimg.com%2Fvi%2Fx%2Fhq.jpg");
    expect(roomArtSource("https://m.media-amazon.com/images/I/a.jpg")).toBe("https://m.media-amazon.com/images/I/a.jpg");
    expect(roomArtSource("http://192.168.0.5:8123/api/media_player_proxy/x")).toBe(null);
    expect(roomArtSource("/api/img?u=x")).toBe("/api/img?u=x");
    expect(roomArtSource(null)).toBe(null);
  });

  test("is idle when nothing plays, keeping the last thing played", () => {
    expect(roomDisplay(kitchen({ current: { ...song, state: "finished" } }))).toEqual({ kind: "idle", last: { ...song, state: "finished" } });
    expect(roomDisplay(kitchen({ current: null }))).toEqual({ kind: "idle", last: null });
    expect(roomDisplay(null)).toEqual({ kind: "idle", last: null });
  });
});

describe("pending buttons", () => {
  test("pause waits until the room stops playing", () => {
    const pause = control("pause", kitchen());
    expect(controlConfirmed(pause, kitchen())).toBe(false);
    expect(controlConfirmed(pause, kitchen({ current: { ...song, state: "paused" } }))).toBe(true);
  });

  test("resume waits until it plays again", () => {
    const paused = kitchen({ current: { ...song, state: "paused" } });
    const resume = control("resume", paused);
    expect(controlConfirmed(resume, paused)).toBe(false);
    expect(controlConfirmed(resume, kitchen())).toBe(true);
  });

  test("next waits for another song, or for one to be starting", () => {
    const next = control("next", kitchen());
    expect(controlConfirmed(next, kitchen())).toBe(false);
    expect(controlConfirmed(next, kitchen({ current: { ...song, title: "Old Man" } }))).toBe(true);
    expect(controlConfirmed(next, kitchen({ pending }))).toBe(true);
  });

  test("a play from the tablet waits for the Echo to take it", () => {
    const idle = kitchen({ current: null });
    const play = control("play", idle);
    expect(controlConfirmed(play, idle)).toBe(false);
    expect(controlConfirmed(play, kitchen({ current: null, pending }))).toBe(true);
    expect(controlConfirmed(play, kitchen())).toBe(true);
  });

  test("volume waits for Home Assistant to report the level, when it reports one", () => {
    const at = (volume: number) => kitchen({ homeAssistant: { entity: "media_player.kitchen", error: null, volume } });
    const louder = control("volume", at(0.3), { volume: 6 });
    expect(controlConfirmed(louder, at(0.3))).toBe(false);
    expect(controlConfirmed(louder, at(0.6))).toBe(true);
    expect(controlConfirmed(louder, kitchen())).toBe(true);
    expect(roomVolume(at(0.44))).toBe(4);
  });

  test("stops waiting once confirmed or after the timeout", () => {
    const pause = control("pause", kitchen());
    expect(settleControl(pause, kitchen(), 2_000)).toBe(pause);
    expect(settleControl(pause, kitchen(), 1_000 + CONTROL_TIMEOUT_MS + 1)).toBe(null);
    expect(settleControl(pause, kitchen({ current: { ...song, state: "paused" } }), 2_000)).toBe(null);
    expect(settleControl(null, kitchen(), 0)).toBe(null);
  });
});

describe("idle screen and polling", () => {
  test("dims only when nothing plays and nobody has touched it for a while", () => {
    const idle = roomDisplay(kitchen({ current: null }));
    expect(isIdle(idle, 0, IDLE_AFTER_MS, false)).toBe(true);
    expect(isIdle(idle, 0, IDLE_AFTER_MS - 1, false)).toBe(false);
    expect(isIdle(idle, 0, IDLE_AFTER_MS, true)).toBe(false);
    expect(isIdle(roomDisplay(kitchen()), 0, IDLE_AFTER_MS * 10, false)).toBe(false);
  });

  test("polls fast while a command waits, slower when idle, and never while hidden", () => {
    expect(pollDelay({ visible: true, idle: false, waiting: true })).toBe(1_000);
    expect(pollDelay({ visible: true, idle: false, waiting: false })).toBe(2_500);
    expect(pollDelay({ visible: true, idle: true, waiting: false })).toBe(15_000);
    expect(pollDelay({ visible: false, idle: false, waiting: true })).toBe(null);
  });
});

describe("lyrics", () => {
  test("uses the Hoban Music track when the room plays one, and the song by name otherwise", () => {
    const playing = { skill: "music" as const, videoId: "abcdefghijk", title: "Harvest Moon", artist: "Neil Young", art: "", durationMs: 300_000,
      state: "playing", offsetMs: 0, startedAt: null, positionMs: 0, updatedAt: "" };
    expect(roomLyricsSong(kitchen({ nowPlaying: playing }))).toEqual({ kind: "track", videoId: "abcdefghijk", key: "track:abcdefghijk" });
    const amazon = kitchen({ current: { ...song, origin: "home-assistant", title: "What's Up?", artist: "4 Non Blondes", durationMs: 296_400 } });
    expect(roomLyricsSong(amazon)).toEqual({ kind: "song", artist: "4 Non Blondes", title: "What's Up?", duration: 296, key: "song:4 Non Blondes|What's Up?" });
  });

  test("has none for videos, finished songs, nothing playing, or a song with no artist", () => {
    expect(roomLyricsSong(kitchen({ current: { ...song, origin: "video" } }))).toEqual({ kind: "video" });
    expect(roomLyricsSong(kitchen({ current: { ...song, state: "finished" } }))).toBe(null);
    expect(roomLyricsSong(kitchen({ current: null }))).toBe(null);
    expect(roomLyricsSong(kitchen({ current: { ...song, origin: "home-assistant", artist: null } }))).toBe(null);
  });
});

describe("rooms", () => {
  const rooms: AlexaRooms = { serverTime: "2030-06-01T12:00:00Z", rooms: [kitchen(), kitchen({ room: "Living Room" })], unpaired: [], pairing: null };

  test("finds a room whatever its capitalisation", () => {
    expect(findRoom(rooms, "kitchen")?.room).toBe("Kitchen");
    expect(findRoom(rooms, " living room ")?.room).toBe("Living Room");
    expect(findRoom(rooms, "Garage")).toBe(null);
    expect(findRoom(null, "Kitchen")).toBe(null);
  });

  test("builds paths and remembers the tablet's room", () => {
    expect(roomPath("Living Room", "music")).toBe("/room/Living%20Room/music");
    expect(storedRoom({ getItem: () => " Kitchen " })).toBe("Kitchen");
    expect(storedRoom({ getItem: () => { throw new Error("blocked"); } })).toBe(null);
    expect(storedRoom(null)).toBe(null);
  });
});
