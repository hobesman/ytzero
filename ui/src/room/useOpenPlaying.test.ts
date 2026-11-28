import { describe, expect, test } from "bun:test";
import type { RoomCurrent } from "./roomApi";
import { openPlayingTarget } from "./useOpenPlaying";

const current = (overrides: Partial<RoomCurrent>): RoomCurrent => ({
  origin: "music", videoId: "song0000001", state: "playing", title: "Song", artist: "Band", art: null,
  durationMs: null, positionMs: null, source: null, ...overrides,
} as RoomCurrent);

describe("tapping now playing's cover", () => {
  test("opens a song's album and a book's page", () => {
    expect(openPlayingTarget(current({}))).toEqual({ kind: "song", videoId: "song0000001" });
    const book = current({ origin: "books", videoId: "li_book", book: { bookId: "li_book" } as RoomCurrent["book"] });
    expect(openPlayingTarget(book)).toEqual({ kind: "book", id: "li_book" });
  });

  test("does nothing for a video, Amazon Music or nothing playing", () => {
    expect(openPlayingTarget(current({ origin: "video" }))).toBe(null);
    expect(openPlayingTarget(current({ origin: "home-assistant", videoId: null }))).toBe(null);
    expect(openPlayingTarget(null)).toBe(null);
  });
});
