import { describe, expect, test } from "bun:test";
import type { Book } from "../audiobookshelf/audiobookshelfClient";
import { BOOK_DROP_GRACE_MS, createBookProgressSync, type PlayingBookRecord } from "./alexaBookProgressSync";
import { encodeBookToken } from "./alexaBookSkill";
import type { NowPlaying } from "./alexaNowPlaying";

const START = Date.parse("2026-11-27T12:00:00Z");
// Two files of an hour each.
const book = { id: "li_book", duration: 7200, tracks: [{ startOffset: 0, duration: 3600 }, { startOffset: 3600, duration: 3600 }] } as unknown as Book;

function harness(records: PlayingBookRecord[]) {
  const clock = { now: START };
  const saved: { bookId: string; currentTime: number }[] = [];
  const timers: (() => void)[] = [];
  const store = new Map(records.map((item) => [`${item.userId}\n${item.deviceId}`, item.record]));
  const sync = createBookProgressSync({
    playing: async () => [...store].filter(([, record]) => record.state === "playing").map(([key, record]) => {
      const [userId, deviceId] = key.split("\n");
      return { userId: Number(userId), deviceId: deviceId!, record };
    }),
    nowPlaying: async (userId, deviceId) => store.get(`${userId}\n${deviceId}`) ?? null,
    saveNowPlaying: async (userId, deviceId, record) => { store.set(`${userId}\n${deviceId}`, record); },
    book: async (bookId) => bookId === book.id ? book : null,
    saveProgress: async (bookId, update) => { saved.push({ bookId, currentTime: update.currentTime }); },
    now: () => clock.now,
    setTimer: (run) => { timers.push(run); },
  });
  const runTimers = () => { for (const run of timers.splice(0)) run(); };
  return { clock, saved, store, sync, runTimers };
}

/** The second file, started `startedAgoMs` before START at its beginning. */
const playing = (startedAgoMs: number, state: NowPlaying["state"] = "playing"): NowPlaying => ({
  token: encodeBookToken(book.id, 1), videoId: book.id, title: "A Book", artist: "An Author", art: "",
  durationMs: 3600_000, state, offsetMs: 0, startedAt: state === "playing" ? new Date(START - startedAgoMs).toISOString() : null,
  nextToken: null, updatedAt: new Date(START - startedAgoMs).toISOString(),
});

describe("saving a playing book's place", () => {
  test("saves the place worked out from when the stream started", async () => {
    const { saved, sync } = harness([{ userId: 1, deviceId: "echo", record: playing(600_000) }]);
    await sync.tick();
    expect(saved).toEqual([{ bookId: book.id, currentTime: 3600 + 600 }]);
  });

  test("doesn't save again until the place has moved on", async () => {
    const { clock, saved, sync } = harness([{ userId: 1, deviceId: "echo", record: playing(600_000) }]);
    await sync.tick();
    clock.now += 5_000;
    await sync.tick();
    clock.now += 60_000;
    await sync.tick();
    expect(saved.map((item) => item.currentTime)).toEqual([4200, 4265]);
  });

  test("leaves alone a paused book and a file that has played out", async () => {
    const { saved, sync } = harness([
      { userId: 1, deviceId: "paused", record: playing(600_000, "paused") },
      { userId: 1, deviceId: "stale", record: playing(5 * 3600_000) },
    ]);
    await sync.tick();
    expect(saved).toEqual([]);
  });
});

describe("a dropped stream", () => {
  test("with nothing after it, marks the book stopped where it had reached and saves that", async () => {
    const { clock, saved, store, sync, runTimers } = harness([{ userId: 1, deviceId: "echo", record: playing(600_000) }]);
    const done = sync.dropped(1, encodeBookToken(book.id, 1));
    clock.now += BOOK_DROP_GRACE_MS;
    runTimers();
    await done;
    const record = store.get("1\necho")!;
    expect(record.state).toBe("stopped");
    expect(record.offsetMs).toBe(600_000);
    expect(record.startedAt).toBe(null);
    expect(saved).toEqual([{ bookId: book.id, currentTime: 4200 }]);
  });

  test("isn't one when the Echo asks for the stream again", async () => {
    const { clock, saved, store, sync, runTimers } = harness([{ userId: 1, deviceId: "echo", record: playing(600_000) }]);
    const done = sync.dropped(1, encodeBookToken(book.id, 1));
    clock.now += 1_000;
    sync.opened(1, encodeBookToken(book.id, 1));
    runTimers();
    await done;
    expect(store.get("1\necho")!.state).toBe("playing");
    expect(saved).toEqual([]);
  });

  test("isn't one when an event came in after it", async () => {
    const { clock, saved, store, sync, runTimers } = harness([{ userId: 1, deviceId: "echo", record: playing(600_000) }]);
    const done = sync.dropped(1, encodeBookToken(book.id, 1));
    clock.now += 1_000;
    store.set("1\necho", { ...playing(600_000), updatedAt: new Date(clock.now).toISOString() });
    runTimers();
    await done;
    expect(store.get("1\necho")!.state).toBe("playing");
    expect(saved).toEqual([]);
  });

  test("leaves other profiles' and other streams' records alone", async () => {
    const other = { ...playing(600_000), token: encodeBookToken(book.id, 0) };
    const { store, sync, runTimers } = harness([
      { userId: 2, deviceId: "echo", record: playing(600_000) },
      { userId: 1, deviceId: "echo", record: other },
    ]);
    const done = sync.dropped(1, encodeBookToken(book.id, 1));
    runTimers();
    await done;
    expect(store.get("2\necho")!.state).toBe("playing");
    expect(store.get("1\necho")!.state).toBe("playing");
  });
});
