import { describe, expect, test } from "bun:test";
import {
  bookPosition, chapterAt, chaptersOf, nextChapterStart, placeInBook, previousChapterStart, resumePosition, spokenChapter, spokenDuration, timeLeft,
} from "./alexaBookMath";
import { bookNowPlaying } from "./alexaBookNowPlaying";
import { MULTI_FILE_BOOK, SINGLE_FILE_BOOK } from "./alexaBookTestBooks";

describe("places in a book", () => {
  test("a single-file book is one file from start to end", () => {
    expect(placeInBook(SINGLE_FILE_BOOK, 18_123.5)).toEqual({ fileIndex: 0, offset: 18_123.5 });
    expect(bookPosition(SINGLE_FILE_BOOK, 0, 18_123.5)).toBe(18_123.5);
  });

  test("a book in many files finds the file and the place in it", () => {
    expect(placeInBook(MULTI_FILE_BOOK, 0)).toEqual({ fileIndex: 0, offset: 0 });
    expect(placeInBook(MULTI_FILE_BOOK, 2_999)).toEqual({ fileIndex: 0, offset: 2_999 });
    expect(placeInBook(MULTI_FILE_BOOK, 3_000)).toEqual({ fileIndex: 1, offset: 0 });
    expect(placeInBook(MULTI_FILE_BOOK, 7_250)).toEqual({ fileIndex: 2, offset: 1_250 });
    expect(bookPosition(MULTI_FILE_BOOK, 2, 1_250)).toBe(7_250);
  });

  test("places outside the book are kept inside it, short of the very end", () => {
    expect(placeInBook(MULTI_FILE_BOOK, -50)).toEqual({ fileIndex: 0, offset: 0 });
    expect(placeInBook(MULTI_FILE_BOOK, 99_999)).toEqual({ fileIndex: 2, offset: 2_999 });
    // A file's reported offset can't run past the file.
    expect(bookPosition(MULTI_FILE_BOOK, 0, 5_000)).toBe(3_000);
  });
});

describe("chapters", () => {
  test("finds the chapter at a place, including one that spans files", () => {
    expect(chapterAt(SINGLE_FILE_BOOK, 20_000)).toEqual({ index: 2, chapter: SINGLE_FILE_BOOK.chapters[2]! });
    expect(chapterAt(MULTI_FILE_BOOK, 3_500)?.chapter.title).toBe("Two");
  });

  test("next and previous chapter starts", () => {
    expect(nextChapterStart(MULTI_FILE_BOOK, 2_500)).toBe(4_500);
    expect(nextChapterStart(MULTI_FILE_BOOK, 5_000)).toBeNull();
    expect(previousChapterStart(MULTI_FILE_BOOK, 5_000)).toBe(2_000);
    expect(previousChapterStart(MULTI_FILE_BOOK, 100)).toBe(0);
  });

  test("a book in many files with no chapter marks uses its files as chapters", () => {
    const parts = { ...MULTI_FILE_BOOK, chapters: [] };
    expect(chaptersOf(parts).map((chapter) => chapter.start)).toEqual([0, 3_000, 6_000]);
    expect(nextChapterStart(parts, 1_000)).toBe(3_000);
    expect(chaptersOf({ ...SINGLE_FILE_BOOK, chapters: [] })).toEqual([]);
    expect(nextChapterStart({ ...SINGLE_FILE_BOOK, chapters: [] }, 10)).toBeNull();
  });

  test("time left in the chapter and the book", () => {
    expect(timeLeft(MULTI_FILE_BOOK, 4_000)).toEqual({ chapter: 500, book: 5_000 });
    expect(timeLeft({ ...SINGLE_FILE_BOOK, chapters: [] }, 30_000)).toEqual({ chapter: null, book: 6_000 });
  });
});

describe("speech", () => {
  test("durations", () => {
    expect(spokenDuration(40)).toBe("40 seconds");
    expect(spokenDuration(61)).toBe("1 minute");
    expect(spokenDuration(12 * 60 + 20)).toBe("12 minutes");
    expect(spokenDuration(3 * 3600 + 12 * 60)).toBe("3 hours and 12 minutes");
    expect(spokenDuration(3600)).toBe("1 hour");
  });

  test("chapter names", () => {
    expect(spokenChapter({ start: 0, end: 1, title: "2" }, 5)).toBe("chapter 2");
    expect(spokenChapter({ start: 0, end: 1, title: "The Storm" }, 5)).toBe("The Storm");
    expect(spokenChapter({ start: 0, end: 1, title: "" }, 5)).toBe("chapter 6");
  });
});

describe("resume positions", () => {
  test("a saved place resumes; a finished book or one at its very end starts over", () => {
    expect(resumePosition(SINGLE_FILE_BOOK, { currentTime: 18_000, isFinished: false })).toBe(18_000);
    expect(resumePosition(SINGLE_FILE_BOOK, { currentTime: 18_000, isFinished: true })).toBe(0);
    expect(resumePosition(SINGLE_FILE_BOOK, { currentTime: 35_990, isFinished: false })).toBe(0);
    expect(resumePosition(SINGLE_FILE_BOOK, null)).toBe(0);
  });
});

describe("now playing for the tablet", () => {
  test("a place in the second file shows its chapter and the whole book's progress", () => {
    expect(bookNowPlaying(MULTI_FILE_BOOK, "hb1.li_multi.1", 500_000)).toEqual({
      bookId: "li_multi", author: "Bo Writer", chapterTitle: "Two", chapterIndex: 1, chapterCount: 3,
      chapterPositionMs: 1_500_000, chapterDurationMs: 2_500_000, bookPositionMs: 3_500_000, bookDurationMs: 9_000_000,
    });
    expect(bookNowPlaying(MULTI_FILE_BOOK, "hb1.other.1", 0)).toBeNull();
  });
});
