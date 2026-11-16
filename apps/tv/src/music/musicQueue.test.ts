import { describe, expect, test } from "bun:test";
import type { MusicTrack } from "./musicApi";
import {
  appendTracks, applyTrackChange, createQueue, endReason, moveUpcoming, needsMore, playingFrom, queueTrack, removeTrack, served, shuffleTracks, takenElsewhere, upNext,
  type MusicQueue,
} from "./musicQueue";

const track = (videoId: string): MusicTrack => ({
  videoId, title: videoId, artist: "Artist", artistId: null, album: null, duration: 200, thumbnail: null, isTopic: true, rating: null,
});
const start = new Date("2026-11-13T10:00:00Z");
const later = new Date("2026-11-13T10:03:20Z");

describe("music queue", () => {
  test("drops duplicates when a station returns songs already queued", () => {
    const queue = createQueue({ kind: "mix" }, "mix", [track("a"), track("b"), track("a")], start);
    expect(queue.tracks.map((entry) => entry.videoId)).toEqual(["a", "b"]);
    const { queue: next, added } = appendTracks(queue, [track("b"), track("c")]);
    expect(added.map((entry) => entry.videoId)).toEqual(["c"]);
    expect(served(next)).toEqual(["a", "b", "c"]);
  });

  test("asks for more once fewer than three songs are left ahead", () => {
    const queue = createQueue({ kind: "mix" }, "mix", ["a", "b", "c", "d"].map(track), start);
    expect(needsMore(queue)).toBe(false);
    const moved = applyTrackChange(queue, { index: 1, videoId: "b", reason: "auto", previous: { videoId: "a", position: 199, duration: 200 } }, later);
    expect(needsMore(moved.queue)).toBe(true);
  });

  test("a finished song records a completed play and readies the one after next", () => {
    const queue = createQueue({ kind: "track", videoId: "a" }, "track:a", ["a", "b", "c"].map(track), start);
    const result = applyTrackChange(queue, { index: 1, videoId: "b", reason: "auto", previous: { videoId: "a", position: 199.6, duration: 200 } }, later);
    expect(result.play).toEqual({ videoId: "a", startedAt: start.toISOString(), listenedSeconds: 200, duration: 200, endReason: "completed", stationSeed: "track:a" });
    expect(result.prepare).toBe("c");
    expect(result.queue.index).toBe(1);
    expect(result.queue.startedAt).toBe(later.toISOString());
  });

  test("skipping early counts as a skip and is sent back to the station", () => {
    const queue = createQueue({ kind: "mix" }, "mix", ["a", "b"].map(track), start);
    const result = applyTrackChange(queue, { index: 1, videoId: "b", reason: "seek", previous: { videoId: "a", position: 12, duration: 200 } }, later);
    expect(result.play?.endReason).toBe("skipped");
    expect(result.queue.skipped).toEqual(["a"]);
  });

  test("skipping in the last seconds counts as finished", () => {
    expect(endReason({ reason: "seek" }, { videoId: "a", position: 195, duration: 200 })).toBe("completed");
    expect(endReason({ reason: "playlist" }, { videoId: "a", position: 40, duration: 200 })).toBe("stopped");
  });

  test("a song that never played records nothing", () => {
    const queue = createQueue({ kind: "mix" }, "mix", ["a", "b"].map(track), start);
    const result = applyTrackChange(queue, { index: 1, videoId: "b", reason: "seek", previous: { videoId: "a", position: 0, duration: 0 } }, later);
    expect(result.play).toBeNull();
  });

  test("a replaced queue records nothing for the old song", () => {
    const queue = createQueue({ kind: "mix" }, "mix", ["a", "b"].map(track), start);
    const result = applyTrackChange(queue, { index: 0, videoId: "a", reason: "playlist", previous: { videoId: "x", position: 50, duration: 200 } }, later);
    expect(result.play).toBeNull();
  });

  test("only songs still to come can be removed", () => {
    const queue = { ...createQueue({ kind: "mix" }, "mix", ["a", "b", "c"].map(track), start), index: 1 };
    expect(removeTrack(queue, 0)).toBe(queue);
    expect(removeTrack(queue, 1)).toBe(queue);
    expect(upNext(removeTrack(queue, 2))).toEqual([]);
  });

  test("shuffles an album without losing or repeating songs", () => {
    const ids = ["a", "b", "c", "d", "e"];
    let seed = 0.3;
    const random = () => (seed = (seed * 9301 + 0.49297) % 1);
    const shuffled = shuffleTracks(ids, random);
    expect([...shuffled].sort()).toEqual(ids);
    expect(shuffled).not.toEqual(ids);
    expect(shuffleTracks([], random)).toEqual([]);
  });

  test("names the album while its songs play, and the station after it", () => {
    const seed = { kind: "album" as const, browseId: "MPREb_album" };
    const queue = createQueue(seed, "album:MPREb_album", ["a", "b"].map(track), start, "Abbey Road");
    expect(playingFrom(queue)).toBe("Abbey Road");
    const withStation = appendTracks(queue, [track("s1"), track("s2")]).queue;
    const onLast = applyTrackChange(withStation, { index: 1, videoId: "b", reason: "auto", previous: { videoId: "a", position: 199, duration: 200 } }, later).queue;
    expect(playingFrom(onLast)).toBe("Abbey Road");
    const onStation = applyTrackChange(onLast, { index: 2, videoId: "s1", reason: "auto", previous: { videoId: "b", position: 199, duration: 200 } }, later).queue;
    expect(playingFrom(onStation)).toBeNull();
    // Removing an album song keeps the boundary between the album and the station.
    expect(removeTrack(queue, 1).from).toEqual({ title: "Abbey Road", count: 1 });
    expect(playingFrom(createQueue({ kind: "mix" }, "mix", [track("a")], start))).toBeNull();
  });

  describe("editing the queue", () => {
    const ids = (queue: MusicQueue) => queue.tracks.map((entry) => entry.videoId);
    const playing = (...videoIds: string[]) => createQueue({ kind: "mix" }, "mix", videoIds.map(track), start);

    test("plays a new song next, right after the one playing", () => {
      const { queue, change } = queueTrack(playing("a", "s1", "s2"), track("x"), "next");
      expect(ids(queue)).toEqual(["a", "x", "s1", "s2"]);
      expect(change).toEqual({ kind: "insert", index: 1, track: track("x") });
      expect(queue.queued).toEqual(["x"]);
    });

    test("adds songs to the queue in the order added, ahead of the station", () => {
      let queue = playing("a", "s1", "s2");
      queue = queueTrack(queue, track("x"), "last").queue;
      const second = queueTrack(queue, track("y"), "last");
      expect(ids(second.queue)).toEqual(["a", "x", "y", "s1", "s2"]);
      expect(second.change).toEqual({ kind: "insert", index: 2, track: track("y") });
      // The station's refill still lands after them.
      expect(ids(appendTracks(second.queue, [track("s3")]).queue)).toEqual(["a", "x", "y", "s1", "s2", "s3"]);
    });

    test("play next jumps ahead of songs already added", () => {
      let queue = queueTrack(playing("a", "s1"), track("x"), "last").queue;
      queue = queueTrack(queue, track("y"), "next").queue;
      expect(ids(queue)).toEqual(["a", "y", "x", "s1"]);
      // Add to queue still goes after both.
      expect(ids(queueTrack(queue, track("z"), "last").queue)).toEqual(["a", "y", "x", "z", "s1"]);
    });

    test("moves a song already queued instead of adding it twice", () => {
      const ahead = queueTrack(playing("a", "s1", "s2", "s3"), track("s3"), "next");
      expect(ids(ahead.queue)).toEqual(["a", "s3", "s1", "s2"]);
      expect(ahead.change).toEqual({ kind: "move", from: 3, to: 1 });
      // A song already played comes back after the one playing; the playing index follows it.
      const onB = { ...playing("a", "b", "c"), index: 1 };
      const again = queueTrack(onB, track("a"), "next");
      expect(ids(again.queue)).toEqual(["b", "a", "c"]);
      expect(again.queue.index).toBe(0);
      expect(again.change).toEqual({ kind: "move", from: 0, to: 1 });
    });

    test("leaves the playing song alone", () => {
      const queue = playing("a", "b");
      expect(queueTrack(queue, track("a"), "next")).toEqual({ queue, change: null });
    });

    test("reorders only songs still to come", () => {
      const queue = { ...playing("a", "b", "c", "d"), index: 1 };
      const moved = moveUpcoming(queue, 3, 2);
      expect(ids(moved.queue)).toEqual(["a", "b", "d", "c"]);
      expect(moved.change).toEqual({ kind: "move", from: 3, to: 2 });
      // Dragging above the playing song stops just after it.
      expect(ids(moveUpcoming(queue, 3, 0).queue)).toEqual(["a", "b", "d", "c"]);
      expect(moveUpcoming(queue, 0, 3).change).toBeNull();
    });

    test("removing a hand-queued song forgets it", () => {
      const queue = queueTrack(playing("a", "s1"), track("x"), "next").queue;
      expect(removeTrack(queue, 1).queued).toEqual([]);
    });

    test("a song added into an album keeps the album's last songs labelled", () => {
      const album = createQueue({ kind: "album", browseId: "B" }, "album:B", ["a", "b"].map(track), start, "Album");
      expect(queueTrack(album, track("x"), "next").queue.from).toEqual({ title: "Album", count: 3 });
    });
  });
});

describe("takenElsewhere", () => {
  test("a song this queue never handed the player means the car took over", () => {
    const queue = createQueue({ kind: "mix" }, "mix", ["a", "b"].map(track), start);
    expect(takenElsewhere(queue, { videoId: "b" })).toBe(false);
    expect(takenElsewhere(queue, { videoId: "car" })).toBe(true);
    // The queue being cleared is not a takeover.
    expect(takenElsewhere(queue, { videoId: null })).toBe(false);
  });
});
