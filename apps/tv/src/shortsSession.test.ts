import { describe, expect, test } from "bun:test";
import { appendShorts, loadedShorts, pageAt, shortsFrom, wantsMoreShorts } from "./shortsSession";
import type { Video } from "./types";

const video = (id: string, short = true): Video => ({
  video_id: id, title: id, description: "", thumbnail: "", channel_title: "", published_at: null, duration: "0:30",
  live_status: "none", watched: 0, status: "inbox", is_short: short ? 1 : 0,
});

describe("Shorts sessions", () => {
  test("start at the tapped Short among a screen's Shorts", () => {
    const list = [video("a"), video("long", false), video("b"), video("c")];
    expect(shortsFrom(list, list[2]!)).toMatchObject({ index: 1 });
    expect(shortsFrom(list, list[2]!).items.map((item) => item.video_id)).toEqual(["a", "b", "c"]);
  });

  test("a Short missing from the list plays on its own", () => {
    expect(shortsFrom([video("a")], video("z"))).toMatchObject({ index: 0, items: [{ video_id: "z" }] });
  });

  test("loading more skips duplicates and long videos", () => {
    const items = [video("a"), video("b")];
    expect(appendShorts(items, [video("b"), video("c"), video("long", false), video("c")]).map((item) => item.video_id)).toEqual(["a", "b", "c"]);
    expect(appendShorts(items, [video("a")])).toBe(items);
  });

  test("keeps the Short on screen and its neighbours loaded", () => {
    const items = [video("a"), video("b"), video("c"), video("d")];
    expect(loadedShorts(items, 0).map((item) => item.video_id)).toEqual(["a", "b"]);
    expect(loadedShorts(items, 2).map((item) => item.video_id)).toEqual(["c", "d", "b"]);
  });

  test("fetches more near the end", () => {
    expect(wantsMoreShorts(10, 5)).toBe(false);
    expect(wantsMoreShorts(10, 7)).toBe(true);
  });

  test("settles on the nearest page", () => {
    expect(pageAt(0, 800, 5)).toBe(0);
    expect(pageAt(1250, 800, 5)).toBe(2);
    expect(pageAt(99999, 800, 5)).toBe(4);
    expect(pageAt(100, 0, 5)).toBe(0);
  });
});
