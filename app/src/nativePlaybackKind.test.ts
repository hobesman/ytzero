import { describe, expect, test } from "bun:test";
import { nativeKindForDirectPlaylist } from "./nativePlaybackKind";

describe("nativeKindForDirectPlaylist", () => {
  test("keeps HLS when the playlist can be built", () => {
    expect(nativeKindForDirectPlaylist("playlist")).toBe("direct-hls");
    expect(nativeKindForDirectPlaylist("stale")).toBe("direct-hls");
  });

  test("falls back to the progressive stream when HLS cannot be built", () => {
    expect(nativeKindForDirectPlaylist("failed")).toBe("direct");
    expect(nativeKindForDirectPlaylist("unsupported")).toBe("direct");
  });
});
