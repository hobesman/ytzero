import { describe, expect, test } from "bun:test";
import type { MusicTrack } from "./musicApi";
import {
  appendTracks, createQueue, current, endReason, fromTitle, moveTo, moveUpcoming, needsMore, playRecord, queueTrack, rateTrack, removeUpcoming, served,
  shuffleTracks, type MusicQueue,
} from "./musicQueue";

const track = (videoId: string, duration = 200): MusicTrack => ({
  videoId, title: videoId, artist: "Artist", artistId: null, album: null, duration, thumbnail: null, isTopic: true, rating: null,
});
const tracks = (...ids: string[]) => ids.map((id) => track(id));

describe("music queue", () => {
  test("drops repeated songs and starts at the first", () => {
    const queue = createQueue({ kind: "mix" }, "mix", tracks("a", "b", "a", "c"));
    expect(queue.tracks.map((t) => t.videoId)).toEqual(["a", "b", "c"]);
    expect(current(queue)?.videoId).toBe("a");
  });

  test("asks for more with fewer than three songs left, and appends only new ones", () => {
    let queue = createQueue({ kind: "mix" }, "mix", tracks("a", "b", "c", "d"));
    expect(needsMore(queue)).toBe(false);
    queue = moveTo(queue, 1, false);
    expect(needsMore(queue)).toBe(true);
    queue = appendTracks(queue, tracks("c", "e"));
    expect(queue.tracks.map((t) => t.videoId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(served(queue)).toEqual(["a", "b"]);
  });

  test("remembers skips, and drops a disliked song from what's to come", () => {
    let queue = moveTo(createQueue({ kind: "mix" }, "mix", tracks("a", "b", "c")), 1, true);
    expect(queue.skipped).toEqual(["a"]);
    queue = removeUpcoming(rateTrack(queue, "c", -1), "c");
    expect(queue.tracks.map((t) => t.videoId)).toEqual(["a", "b"]);
    queue = removeUpcoming(queue, "a");
    expect(queue.tracks.map((t) => t.videoId)).toEqual(["a", "b"]);
  });

  test("labels an album's own songs, not the station after them", () => {
    let queue = createQueue({ kind: "album", browseId: "MPRE1" }, "album:MPRE1", tracks("a", "b"), "Album");
    expect(fromTitle(queue)).toBe("Album");
    queue = moveTo(appendTracks(queue, tracks("c")), 2, false);
    expect(fromTitle(queue)).toBe(null);
  });

  test("shuffles every song exactly once", () => {
    const values = [0.9, 0.1, 0.5, 0.3];
    let call = 0;
    const shuffled = shuffleTracks(["a", "b", "c", "d", "e"], () => values[call++ % values.length]);
    expect([...shuffled].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("records a listen with its reason, capped at the song's length", () => {
    const queue = createQueue({ kind: "mix" }, "mix", tracks("a"));
    expect(endReason(199, 200, false, true)).toBe("completed");
    expect(endReason(20, 200, false, true)).toBe("skipped");
    expect(endReason(20, 200, false, false)).toBe("stopped");
    const record = playRecord(queue, track("a"), new Date("2026-01-01T00:00:00Z"), 250.4, "completed");
    expect(record).toEqual({ videoId: "a", startedAt: "2026-01-01T00:00:00.000Z", listenedSeconds: 200, duration: 200, endReason: "completed", stationSeed: "mix" });
  });

  describe("editing the queue", () => {
    const ids = (queue: MusicQueue) => queue.tracks.map((entry) => entry.videoId);
    const playing = (...videoIds: string[]) => createQueue({ kind: "mix" }, "mix", tracks(...videoIds));

    test("play next goes right after the playing song; add to queue after other added songs", () => {
      let queue = queueTrack(playing("a", "s1", "s2"), track("x"), "last");
      queue = queueTrack(queue, track("y"), "last");
      expect(ids(queue)).toEqual(["a", "x", "y", "s1", "s2"]);
      queue = queueTrack(queue, track("z"), "next");
      expect(ids(queue)).toEqual(["a", "z", "x", "y", "s1", "s2"]);
      expect(queue.queued).toEqual(["x", "y", "z"]);
    });

    test("the station's refill lands after songs added by hand", () => {
      const queue = appendTracks(queueTrack(playing("a", "s1"), track("x"), "last"), tracks("s2"));
      expect(ids(queue)).toEqual(["a", "x", "s1", "s2"]);
      // And playing through the added song keeps the order.
      expect(current(moveTo(queue, 1, false))?.videoId).toBe("x");
    });

    test("moves a song already in the queue instead of repeating it", () => {
      expect(ids(queueTrack(playing("a", "s1", "s2"), track("s2"), "next"))).toEqual(["a", "s2", "s1"]);
      const onB = moveTo(playing("a", "b", "c"), 1, false);
      const again = queueTrack(onB, track("a"), "next");
      expect(ids(again)).toEqual(["b", "a", "c"]);
      expect(current(again)?.videoId).toBe("b");
      expect(queueTrack(onB, track("b"), "last")).toBe(onB);
    });

    test("reorders only what is still to come", () => {
      const queue = moveTo(playing("a", "b", "c", "d"), 1, false);
      expect(ids(moveUpcoming(queue, 3, 2))).toEqual(["a", "b", "d", "c"]);
      expect(ids(moveUpcoming(queue, 3, 0))).toEqual(["a", "b", "d", "c"]);
      expect(moveUpcoming(queue, 0, 2)).toBe(queue);
    });

    test("removing an added song forgets it was added", () => {
      const queue = queueTrack(playing("a", "s1"), track("x"), "next");
      expect(removeUpcoming(queue, "x").queued).toEqual([]);
    });
  });
});
