import { describe, expect, test } from "bun:test";
import { subscriptionList } from "./subscriptionList";
import type { Channel } from "./types";

const channel = (channel_id: string, title: string, extra: Partial<Channel> = {}): Channel => ({ channel_id, title, thumbnail: "", tags: [], followed: 1, ...extra });
const channels = [
  channel("a", "beta", { handle: "@zed", latest_video_at: "2026-11-01T00:00:00Z" }),
  channel("b", "Alpha", { latest_video_at: "2026-11-10T00:00:00Z" }),
  channel("c", "Gamma"),
  channel("d", "Delta", { followed: 0 }),
];
const ids = (list: Channel[]) => list.map((item) => item.channel_id);

describe("subscription list", () => {
  test("sorts followed channels by name, ignoring case", () => {
    expect(ids(subscriptionList(channels, "", "name"))).toEqual(["b", "a", "c"]);
  });

  test("sorts by latest upload, channels without uploads last", () => {
    expect(ids(subscriptionList(channels, "", "latest"))).toEqual(["b", "a", "c"]);
    expect(ids(subscriptionList([channels[2]!, channels[0]!, channels[1]!], "", "latest"))).toEqual(["b", "a", "c"]);
  });

  test("filters by title or handle", () => {
    expect(ids(subscriptionList(channels, "ALP", "name"))).toEqual(["b"]);
    expect(ids(subscriptionList(channels, "zed", "name"))).toEqual(["a"]);
    expect(ids(subscriptionList(channels, "delta", "name"))).toEqual([]);
  });
});
