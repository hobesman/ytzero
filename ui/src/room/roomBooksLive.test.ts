import { describe, expect, test } from "bun:test";
import type { RoomBookSummary, RoomCurrent } from "./roomApi";
import { withPlayingBook } from "./roomBooksLive";

const summary = (id: string, currentTime: number): RoomBookSummary => ({
  id, libraryId: "lib", title: `Book ${id}`, author: "An Author", seriesName: null, duration: 1000, numChapters: 10,
  progress: { currentTime, progress: currentTime / 1000, isFinished: false },
});

const playing = (bookId: string, positionMs: number, state = "playing"): RoomCurrent => ({
  origin: "books", state, title: `Playing ${bookId}`, artist: "An Author", art: "", durationMs: 100_000, positionMs: 0, source: null,
  book: {
    bookId, author: "An Author", chapterTitle: null, chapterIndex: 0, chapterCount: 4,
    chapterPositionMs: 0, chapterDurationMs: 100_000, bookPositionMs: positionMs, bookDurationMs: 1_000_000,
  },
} as RoomCurrent);

describe("continue listening while a book plays", () => {
  test("moves the playing book to the front at its live place", () => {
    const books = withPlayingBook([summary("a", 100), summary("b", 50)], playing("b", 400_000));
    expect(books.map((book) => book.id)).toEqual(["b", "a"]);
    expect(books[0]!.progress).toEqual({ currentTime: 400, progress: 0.4, isFinished: false });
    expect(books[0]!.title).toBe("Book b");
  });

  test("adds a book that isn't in the list yet", () => {
    const books = withPlayingBook([summary("a", 100)], playing("new", 10_000));
    expect(books.map((book) => book.id)).toEqual(["new", "a"]);
    expect(books[0]!.title).toBe("Playing new");
    expect(books[0]!.duration).toBe(1000);
  });

  test("leaves the list alone when no book plays or it has finished", () => {
    const list = [summary("a", 100)];
    expect(withPlayingBook(list, null)).toEqual(list);
    expect(withPlayingBook(list, playing("a", 900_000, "finished"))).toEqual(list);
    expect(withPlayingBook(list, { ...playing("a", 5), origin: "music" } as RoomCurrent)).toEqual(list);
  });
});
