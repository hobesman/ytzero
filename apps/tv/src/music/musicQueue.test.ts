import { describe, expect, test } from "bun:test";
import type { MusicTrack } from "./musicApi";
import { appendTracks, applyTrackChange, createQueue, endReason, needsMore, playingFrom, removeTrack, served, shuffleTracks, upNext } from "./musicQueue";

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
});
