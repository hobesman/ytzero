import { describe, expect, test } from "bun:test";
import { fetchPlaylistFeedOrStored } from "./playlistFeedFallback";

const stored = { channel_id: "UCowner", title: "The Amazing Digital Circus", channel_title: "GLITCH" };
const feed = { playlistId: "PL1", title: "From feed", channelId: "UCfeed", channelTitle: "Feed", videos: [] };

describe("playlist feed fallback", () => {
  test("uses the feed when YouTube serves one", async () => {
    expect(await fetchPlaylistFeedOrStored("PL1", true, 1, {
      fetchFeed: async () => feed,
      lookup: async () => { throw new Error("not consulted"); },
    })).toBe(feed);
  });

  test("falls back to the stored playlist when the feed is missing", async () => {
    const result = await fetchPlaylistFeedOrStored("PL1", true, 1, {
      fetchFeed: async () => { throw new Error("playlist feed fetch failed (404)"); },
      lookup: async (id) => id === "PL1" ? stored : null,
    });
    expect(result).toEqual({ playlistId: "PL1", title: "The Amazing Digital Circus", channelId: "UCowner", channelTitle: "GLITCH", videos: [] });
  });

  test("still fails for an unknown playlist or any other error", async () => {
    const missing = () => { throw new Error("playlist feed fetch failed (404)"); };
    await expect(fetchPlaylistFeedOrStored("PL1", true, 1, { fetchFeed: async () => missing(), lookup: async () => null }))
      .rejects.toThrow("(404)");
    await expect(fetchPlaylistFeedOrStored("PL1", true, 1, {
      fetchFeed: async () => { throw new Error("playlist feed fetch failed (500)"); },
      lookup: async () => stored,
    })).rejects.toThrow("(500)");
  });
});
