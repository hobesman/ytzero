import { describe, expect, test } from "bun:test";
import { searchModeForPath, searchPath } from "./searchMode";

describe("searchModeForPath", () => {
  test("music pages search music", () => {
    expect(searchModeForPath("/music")).toBe("music");
    expect(searchModeForPath("/music/search")).toBe("music");
    expect(searchModeForPath("/music/album/MPRE123")).toBe("music");
  });

  test("everything else searches videos", () => {
    expect(searchModeForPath("/")).toBe("videos");
    expect(searchModeForPath("/search")).toBe("videos");
    expect(searchModeForPath("/channel/UC123")).toBe("videos");
    expect(searchModeForPath("/musicals")).toBe("videos");
  });
});

describe("searchPath", () => {
  test("trims and encodes the query", () => {
    expect(searchPath("videos", "  cats & dogs ")).toBe("/search?q=cats%20%26%20dogs");
    expect(searchPath("music", "AC/DC")).toBe("/music/search?q=AC%2FDC");
  });

  test("an empty search goes home for videos and to the music search page for music", () => {
    expect(searchPath("videos", "  ")).toBe("/");
    expect(searchPath("music", "")).toBe("/music/search");
  });
});
