import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AsyncDatabaseClient } from "../databaseClient";
import type { MusicEchoPlay } from "../music/musicEchoPlays";
import type { MusicPlay } from "../music/musicPlays";
import { songKey } from "../music/musicSongKey";
import type { MusicTrack } from "../music/youtubeMusicParsers";
import { createEchoListening, createEchoListeningTracker, isEchoSong } from "./alexaEchoListening";
import { acceptsSearchResult, createEchoMatcher, ECHO_SEARCH_SPACING_MS } from "./alexaEchoMatch";
import { createAlexaRoomStore } from "./alexaRooms";
import { createAlexaRoomSettings } from "./alexaRoomSettings";
import type { HomeAssistantState } from "./homeAssistant";

const NOW = Date.parse("2030-06-01T12:00:00Z");
const POLL = 15_000;
const KITCHEN = "media_player.kitchen_kitchen_dot";

type Report = Parameters<typeof isEchoSong>[0];
const report = (title: string, artist: string, durationS: number, positionS: number, state = "playing", album: string | null = "Custom Mix"): Report => ({
  state, title, artist, album, art: "https://m.media-amazon.com/images/I/x.jpg", durationMs: durationS * 1000, positionMs: positionS * 1000,
});

/** A Home Assistant state as Alexa Media Player reports it, position as of `at`. */
const haState = (entity: string, title: string | null, artist: string | null, durationS: number | null, positionS: number, at: number, state = "playing", album = "Custom Mix"): HomeAssistantState => ({
  entity_id: entity, state,
  attributes: {
    last_called: false, media_content_type: state === "idle" ? "idle" : "music", source: "Local Speaker",
    ...(title ? { media_title: title, media_artist: artist, media_album_name: album, media_duration: durationS, media_position: positionS,
      media_position_updated_at: new Date(at).toISOString(), entity_picture: "https://m.media-amazon.com/images/I/x.jpg" } : {}),
  },
});

const track = (videoId: string, artist: string, title: string, duration: number | null, isTopic = false): MusicTrack =>
  ({ videoId, title, artist, artistId: null, album: null, duration, thumbnail: "", isTopic });

async function memoryDb() {
  const db = new AsyncDatabaseClient("sqlite", ":memory:");
  await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY)");
  await db.exec("INSERT INTO users (id) VALUES (1), (2)");
  await db.exec(readFileSync(new URL("../musicSchema.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../alexaSchema.sql", import.meta.url), "utf8"));
  return db;
}

async function catalogue(db: AsyncDatabaseClient, tracks: readonly MusicTrack[]) {
  for (const t of tracks) {
    await db.prepare("INSERT INTO music_tracks (video_id, title, artist, duration, is_topic, song_key) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(video_id) DO NOTHING")
      .run(t.videoId, t.title, t.artist, t.duration, t.isTopic ? 1 : 0, songKey(t.artist, t.title));
  }
}

describe("echo songs", () => {
  test("a song is one with a title, an artist and a song's length", () => {
    expect(isEchoSong(report("Wonderwall (Remastered)", "Oasis", 259, 1))).toBe(true);
    // Ash Room's podcast comes through the same Local Speaker source, reported as "music".
    expect(isEchoSong(report("The Magnus Archives", "MAG 10 Vampire Killer", 1562, 63, "playing", "Rusty Quill"))).toBe(false);
    // An Audible chapter, reported as "music" too.
    expect(isEchoSong(report("She", "By H. Rider Haggard", 600, 1, "paused", "Narrated by Alan Munro"))).toBe(false);
    expect(isEchoSong(report("She", "By H. Rider Haggard", 17, 1, "paused", "Narrated by Alan Munro"))).toBe(false);
    expect(isEchoSong({ ...report("Live radio", "Station", 0, 0), durationMs: null })).toBe(false);
    expect(isEchoSong(report("Jingle", "Brand", 12, 0))).toBe(false);
  });
});

describe("echo listening tracker", () => {
  test("a song skipped after a while ends when the next starts, with about how long it was heard", () => {
    const tracker = createEchoListeningTracker();
    expect(tracker.observe(KITCHEN, report("What's Up?", "4 Non Blondes", 295, 10), NOW)).toEqual([]);
    tracker.observe(KITCHEN, report("What's Up?", "4 Non Blondes", 295, 25), NOW + POLL);
    tracker.observe(KITCHEN, report("What's Up?", "4 Non Blondes", 295, 40), NOW + 2 * POLL);
    const [ended] = tracker.observe(KITCHEN, report("Zombie", "The Cranberries", 306, 2), NOW + 3 * POLL);
    expect(ended).toMatchObject({ title: "What's Up?", artist: "4 Non Blondes", endReason: "skipped", durationMs: 295_000 });
    expect(ended.startedAt.toISOString()).toBe(new Date(NOW - 10_000).toISOString());
    expect(ended.listenedSeconds).toBe(38); // 30 s seen playing, plus half the last gap
    expect(tracker.watching()).toEqual([KITCHEN]);
  });

  test("a song that runs out before the next poll completed", () => {
    const tracker = createEchoListeningTracker();
    tracker.observe(KITCHEN, report("What's Up?", "4 Non Blondes", 295, 250), NOW);
    tracker.observe(KITCHEN, report("What's Up?", "4 Non Blondes", 295, 265), NOW + POLL);
    tracker.observe(KITCHEN, report("What's Up?", "4 Non Blondes", 295, 284), NOW + 2 * POLL);
    const [ended] = tracker.observe(KITCHEN, report("Zombie", "The Cranberries", 306, 3), NOW + 3 * POLL);
    expect(ended).toMatchObject({ endReason: "completed", listenedSeconds: 41 });
  });

  test("an Echo gone idle on its finished song completed it; one stopped part way stopped", () => {
    const tracker = createEchoListeningTracker();
    tracker.observe(KITCHEN, report("Dangerously", "Charlie Puth", 199, 180), NOW);
    const [done] = tracker.observe(KITCHEN, report("Dangerously", "Charlie Puth", 199, 199, "idle"), NOW + POLL);
    expect(done).toMatchObject({ endReason: "completed", listenedSeconds: 15 });
    tracker.observe(KITCHEN, report("Dangerously", "Charlie Puth", 199, 20), NOW + 2 * POLL);
    tracker.observe(KITCHEN, report("Dangerously", "Charlie Puth", 199, 35), NOW + 3 * POLL);
    const [stopped] = tracker.observe(KITCHEN, null, NOW + 4 * POLL);
    expect(stopped).toMatchObject({ endReason: "stopped" });
    expect(tracker.watching()).toEqual([]);
  });

  test("a song heard for a few seconds is not recorded, and a pause adds no listening", () => {
    const tracker = createEchoListeningTracker();
    tracker.observe(KITCHEN, report("Intro", "Band", 200, 0), NOW);
    expect(tracker.observe(KITCHEN, report("Song", "Band", 200, 1), NOW + POLL)).toEqual([]);
    tracker.observe(KITCHEN, report("Song", "Band", 200, 15, "paused"), NOW + 2 * POLL);
    tracker.observe(KITCHEN, report("Song", "Band", 200, 15, "paused"), NOW + 10 * POLL);
    const [ended] = tracker.observe(KITCHEN, report("Other", "Band", 200, 0), NOW + 11 * POLL);
    expect(ended).toMatchObject({ title: "Song", listenedSeconds: 15, endReason: "skipped" });
  });

  test("the same song on repeat is two plays", () => {
    const tracker = createEchoListeningTracker();
    tracker.observe(KITCHEN, report("Loop", "Band", 120, 100), NOW);
    tracker.observe(KITCHEN, report("Loop", "Band", 120, 115), NOW + POLL);
    const [first] = tracker.observe(KITCHEN, report("Loop", "Band", 120, 10), NOW + 2 * POLL);
    expect(first).toMatchObject({ title: "Loop", endReason: "completed" });
    expect(tracker.watching()).toEqual([KITCHEN]);
  });

  test("a podcast is not followed, and starting one ends the song before it", () => {
    const tracker = createEchoListeningTracker();
    tracker.observe(KITCHEN, report("Song", "Band", 200, 0), NOW);
    tracker.observe(KITCHEN, report("Song", "Band", 200, 15), NOW + POLL);
    const [ended] = tracker.observe(KITCHEN, report("The Magnus Archives", "MAG 10", 1562, 0), NOW + 2 * POLL);
    expect(ended).toMatchObject({ endReason: "stopped" });
    expect(tracker.watching()).toEqual([]);
  });
});

describe("echo song matching", () => {
  let db: AsyncDatabaseClient;
  beforeEach(async () => { db = await memoryDb(); });
  const whatsUp = { title: "What's Up?", artist: "4 Non Blondes", durationMs: 295_000 };

  test("prefers a catalogue track the profile played or liked, then a Topic upload, then the closest length", async () => {
    await catalogue(db, [
      track("whatsupVid1", "4 Non Blondes", "What's Up? (Official Music Video)", 300),
      track("whatsupTop1", "4 Non Blondes", "What's Up?", 296, true),
      track("whatsupTop2", "4 Non Blondes", "What's Up", 250, true),
    ]);
    const search = async () => { throw new Error("should not search"); };
    const matcher = createEchoMatcher({ db, search, remember: async () => {} });
    expect(await matcher.match(1, whatsUp)).toEqual({ videoId: "whatsupTop1", via: "catalogue" });
    await db.prepare("INSERT INTO music_plays (user_id, video_id, started_at) VALUES (1, 'whatsupVid1', ?)").run(new Date(NOW).toISOString());
    expect(await matcher.match(1, whatsUp)).toEqual({ videoId: "whatsupVid1", via: "catalogue" });
    // Another profile's plays don't count.
    expect(await matcher.match(2, whatsUp)).toEqual({ videoId: "whatsupTop1", via: "catalogue" });
    await db.prepare("INSERT INTO music_ratings (user_id, video_id, rating) VALUES (2, 'whatsupTop2', 1)").run();
    expect(await matcher.match(2, whatsUp)).toEqual({ videoId: "whatsupTop2", via: "catalogue" });
  });

  test("searches YouTube Music through YT Zero when the catalogue has nothing, and keeps what it accepts", async () => {
    const queries: string[] = [];
    const remembered: string[] = [];
    const matcher = createEchoMatcher({
      db,
      search: async (_userId, query) => {
        queries.push(query);
        return [track("coverVersion", "Some Cover Band", "What's Up?", 295), track("liveVersion1", "4 Non Blondes", "What's Up? (Live at Woodstock)", 330), track("theRealOne1", "4 Non Blondes", "Whats Up", 293, true)];
      },
      remember: async (tracks) => { remembered.push(...tracks.map((t) => t.videoId)); await catalogue(db, tracks); },
    });
    expect(await matcher.match(1, whatsUp)).toEqual({ videoId: "theRealOne1", via: "search" });
    expect(queries).toEqual(["4 Non Blondes What's Up?"]);
    expect(remembered).toEqual(["theRealOne1"]);
    // Next time the catalogue has it.
    expect(await matcher.match(1, whatsUp)).toEqual({ videoId: "theRealOne1", via: "catalogue" });
    expect(queries).toHaveLength(1);
  });

  test("accepts a close title only from the same lead artist and within 10% of the length", () => {
    const song = { title: "Bohemian Rhapsody (Remastered 2011)", artist: "Queen", durationMs: 354_000 };
    expect(acceptsSearchResult(song, track("a0000000001", "Queen", "Bohemian Rhapsody", 355))).toBe(true);
    expect(acceptsSearchResult(song, track("a0000000002", "Queen", "Bohemian Rhapsody - Live Aid", 360))).toBe(true);
    expect(acceptsSearchResult(song, track("a0000000003", "Queen", "Bohemian Rhapsody - Live Aid", 250))).toBe(false);
    expect(acceptsSearchResult(song, track("a0000000004", "Panic! At The Disco", "Bohemian Rhapsody", 354))).toBe(false);
    expect(acceptsSearchResult(song, track("a0000000005", "Queen", "Another One Bites the Dust", 354))).toBe(false);
    expect(acceptsSearchResult({ ...song, artist: "Queen, David Bowie" }, track("a0000000006", "Queen", "Bohemian Rhapsody", null))).toBe(true);
  });

  test("remembers a miss, spaces searches out, and retries a failed search", async () => {
    let clock = NOW;
    let searches = 0;
    let failing = true;
    const matcher = createEchoMatcher({
      db, now: () => clock, remember: async () => {},
      search: async () => { searches++; if (failing) throw new Error("YouTube Music is unavailable"); return [track("otherSong01", "Someone Else", "Deep Cut", 200)]; },
    });
    const obscure = { title: "Deep Cut", artist: "Obscure Band", durationMs: 200_000 };
    expect(await matcher.match(1, obscure)).toMatchObject({ videoId: null, reason: "search-failed" });
    expect(await matcher.match(1, obscure)).toMatchObject({ videoId: null, reason: "rate-limited" });
    clock += ECHO_SEARCH_SPACING_MS;
    failing = false;
    expect(await matcher.match(1, obscure)).toEqual({ videoId: null, reason: "no-match" });
    clock += 60_000;
    expect(await matcher.match(1, obscure)).toEqual({ videoId: null, reason: "recent-miss" });
    expect(searches).toBe(2);
  });
});

describe("echo listening watcher", () => {
  test("records a matched song as a play and an unmatched one apart, and skips our own skills' songs", async () => {
    const db = await memoryDb();
    await catalogue(db, [track("whatsupTop1", "4 Non Blondes", "What's Up?", 296, true)]);
    const settings = createAlexaRoomSettings(db);
    const rooms = createAlexaRoomStore(db);
    let states: HomeAssistantState[] = [];
    let requests = 0;
    const plays: MusicPlay[] = [];
    const echoPlays: MusicEchoPlay[] = [];
    const listening = createEchoListening({
      homeAssistant: { mediaPlayers: async () => { requests++; return states; } },
      userId: async () => 1,
      settings, rooms,
      matcher: createEchoMatcher({ db, search: async () => [], remember: async () => {} }),
      recordPlay: async (_userId, play) => { plays.push(play); },
      recordEchoPlay: async (_userId, play) => { echoPlays.push(play); },
    });

    // No room has an entity yet: Home Assistant isn't asked.
    await listening.tick(NOW);
    expect(requests).toBe(0);
    await settings.setEntity(1, "Kitchen", KITCHEN, NOW);

    let at = NOW;
    const poll = async (next: HomeAssistantState[]) => { states = next; await listening.tick(at); at += POLL; };
    for (let i = 0; i < 4; i++) await poll([haState(KITCHEN, "What's Up?", "4 Non Blondes", 295, 240 + 15 * i, at), haState("media_player.ash_room_ash_room_dot", "The Magnus Archives", "MAG 10", 1562, 63, at)]);
    for (let i = 0; i < 3; i++) await poll([haState(KITCHEN, "Deep Cut", "Obscure Band", 200, 15 * i, at)]);
    await poll([haState(KITCHEN, "Deep Cut", "Obscure Band", 200, 45, at, "idle")]);

    expect(plays).toEqual([{ videoId: "whatsupTop1", startedAt: new Date(NOW - 240_000), listenedSeconds: 55, duration: 295, endReason: "completed", stationSeed: null }]);
    expect(echoPlays).toEqual([{
      songKey: "obscure band|deep cut", title: "Deep Cut", artist: "Obscure Band", album: "Custom Mix", art: "https://m.media-amazon.com/images/I/x.jpg",
      startedAt: new Date(NOW + 4 * POLL), listenedSeconds: 45, duration: 200, endReason: "stopped",
    }]);
    expect(requests).toBe(8);

    // A song one of our skills played in the room is the skill's to record.
    await rooms.setRoom(1, "music", "amzn1.ask.device.KITCHEN", "Kitchen", at);
    await db.prepare(`INSERT INTO alexa_now_playing (user_id, skill, device_id, token, video_id, title, state, updated_at)
      VALUES (1, 'music', 'amzn1.ask.device.KITCHEN', 't', 'whatsupTop1', 'Ours', 'playing', ?)`).run(new Date(at).toISOString());
    for (let i = 0; i < 3; i++) await poll([haState(KITCHEN, "Ours", "Band", 200, 15 * i, at)]);
    await poll([]);
    expect(plays).toHaveLength(1);
    expect(echoPlays).toHaveLength(1);
  });
});
