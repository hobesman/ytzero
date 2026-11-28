import { describe, expect, test } from "bun:test";
import type { PlexItem } from "../plex/plexClient";
import { createAlexaMovieSkill, type MovieApi } from "./alexaMovieSkill";
import type { RoomControlDependencies } from "./alexaRoomControl";
import { playRoomPlex } from "./alexaRoomPlex";
import { createRoomPlexPicks, type RoomPlexPick } from "./alexaRoomPlexPicks";
import type { AlexaEnvelope } from "./alexaSkill";

const movie = (id: string, fields: Partial<PlexItem> = {}): PlexItem => ({
  id, type: "movie", title: `Movie ${id}`, year: 2020, show: null, season: null, episode: null, duration: 6_000, viewOffset: 0, watched: false,
  partKey: `/library/parts/${id}/1/file.mkv`, audio: [], chapters: [], thumb: "", contentRating: "", lastViewedAt: 0, ...fields,
});

describe("room Plex picks", () => {
  test("give the room's Echo the noted title once, within a minute and a half", () => {
    let clock = 0;
    const picks = createRoomPlexPicks(() => clock);
    picks.note(1, "Kitchen", { itemId: "101", startSeconds: 600 });
    expect(picks.take(2, "Kitchen")).toBeNull();
    expect(picks.take(1, "Bedroom")).toBeNull();
    expect(picks.take(1, " kitchen ")).toEqual({ itemId: "101", startSeconds: 600 });
    expect(picks.take(1, "kitchen")).toBeNull();
    picks.note(1, "Kitchen", { itemId: "101", startSeconds: null });
    clock += 91_000;
    expect(picks.take(1, "Kitchen")).toBeNull();
  });
});

describe("starting a Plex title from the tablet", () => {
  const controls = (typed: string[], fields: Partial<RoomControlDependencies> = {}): RoomControlDependencies => ({
    homeAssistant: { typeCommand: async (entity: string, command: string) => { typed.push(`${entity}: ${command}`); } } as never,
    invocations: { music: "hoban music", video: "hoban tube", books: "hoban books", movies: "hoban plex" },
    rooms: { devices: async () => [{ room: "Kitchen" }] } as never,
    settings: { entity: async () => "media_player.kitchen_echo", spelling: async () => null } as never,
    skills: { music: true, video: true, books: true, movies: true },
    now: () => 0,
    ...fields,
  });

  test("notes the pick for the room, then asks Hoban Plex for it on the room's Echo", async () => {
    const typed: string[] = [];
    const picks = createRoomPlexPicks(() => 0);
    const result = await playRoomPlex(controls(typed), 1, "kitchen", { itemId: "101", startSeconds: 600 }, picks);
    expect(result).toEqual({ room: "Kitchen", entity: "media_player.kitchen_echo", via: "typed", command: "ask hoban plex to play my pick" });
    expect(typed).toEqual(["media_player.kitchen_echo: ask hoban plex to play my pick"]);
    expect(picks.take(1, "Kitchen")).toEqual({ itemId: "101", startSeconds: 600 });
  });

  test("refuses without the skill, its invocation name or the room's Echo", async () => {
    const pick: RoomPlexPick = { itemId: "101", startSeconds: null };
    await expect(playRoomPlex(controls([], { skills: { music: true, video: true, books: true, movies: false } }), 1, "Kitchen", pick)).rejects.toThrow("isn't configured");
    await expect(playRoomPlex(controls([], { invocations: { music: null, video: null, books: null, movies: null } }), 1, "Kitchen", pick)).rejects.toThrow("YTZERO_ALEXA_MOVIES_INVOCATION");
    await expect(playRoomPlex(controls([], { settings: { entity: async () => null, spelling: async () => null } as never }), 1, "Kitchen", pick)).rejects.toThrow("no Home Assistant Echo");
  });
});

describe("Hoban Plex's PlayRoomPickIntent", () => {
  const items = new Map([["101", movie("101", { viewOffset: 3_000 })], ["102", movie("102")]]);
  const api = {
    search: async () => [], item: async (id: string) => items.get(id) ?? null, episodes: async () => [],
    onDeck: async () => [items.get("102")!], saveProgress: async () => {}, markWatched: async () => {},
  } satisfies MovieApi;
  const skill = (found: { room: string | null; pick: RoomPlexPick | null }) => createAlexaMovieSkill({
    plex: () => api,
    audioLink: (itemId, _userId, start) => `https://yt.example.com/alexa/movie-audio/${itemId}?t=${start}`,
    posterLink: (itemId) => `https://yt.example.com/alexa/movie-poster/${itemId}`,
    roomPick: async () => found,
    now: () => 0,
  });
  const ask: AlexaEnvelope = {
    context: { System: { device: { deviceId: "echo-1" } } },
    request: { type: "IntentRequest", intent: { name: "PlayRoomPickIntent", slots: {} } },
  };
  const played = async (found: { room: string | null; pick: RoomPlexPick | null }) => {
    const answer = await skill(found).handle(1, ask) as { response: Record<string, any> };
    return { answer, url: answer.response.directives?.find((directive: any) => directive.type === "AudioPlayer.Play")?.audioItem.stream.url as string | undefined };
  };

  test("plays the picked title from the place picked, or from its saved place", async () => {
    expect((await played({ room: "Kitchen", pick: { itemId: "101", startSeconds: 600 } })).url).toBe("https://yt.example.com/alexa/movie-audio/101?t=600");
    expect((await played({ room: "Kitchen", pick: { itemId: "101", startSeconds: null } })).url).toBe("https://yt.example.com/alexa/movie-audio/101?t=3000");
  });

  test("with no pick, carries on with what was last watched; unpaired, says how to pair", async () => {
    expect((await played({ room: "Kitchen", pick: null })).url).toBe("https://yt.example.com/alexa/movie-audio/102?t=0");
    const unpaired = await played({ room: null, pick: null });
    expect(unpaired.url).toBeUndefined();
    expect(JSON.stringify(unpaired.answer)).toContain("isn't paired with a room");
  });
});
