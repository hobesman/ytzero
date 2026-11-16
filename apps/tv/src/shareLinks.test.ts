import { describe, expect, test } from "bun:test";
import { shareMessage, youtubeMusicUrl, youtubeVideoUrl } from "./shareLinks";

describe("share links", () => {
  test("link a video on YouTube and a song on YouTube Music", () => {
    expect(youtubeVideoUrl("dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(youtubeMusicUrl("dQw4w9WgXcQ")).toBe("https://music.youtube.com/watch?v=dQw4w9WgXcQ");
  });
  test("refuse anything that isn't a video id", () => {
    expect(youtubeVideoUrl("")).toBeNull();
    expect(youtubeVideoUrl("abc&list=x")).toBeNull();
    expect(youtubeMusicUrl("../../etc")).toBeNull();
  });
  test("put the title, and the artist when there is one, above the link", () => {
    expect(shareMessage("Song", "https://x", "Artist")).toBe("Song – Artist\nhttps://x");
    expect(shareMessage("Video ", "https://x")).toBe("Video\nhttps://x");
    expect(shareMessage("", "https://x", null)).toBe("https://x");
  });
});
