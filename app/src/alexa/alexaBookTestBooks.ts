import type { Book } from "../audiobookshelf/audiobookshelfClient";

/** Test books. A long single M4B with chapters, and an MP3 book in three files with chapters that cross them. */
export const SINGLE_FILE_BOOK: Book = {
  id: "li_single",
  libraryId: "lib1",
  title: "The Long Way",
  subtitle: null,
  author: "Ann Author",
  narrator: null,
  series: [{ id: "ser1", name: "Way", sequence: "1" }],
  duration: 36_000,
  tracks: [{ index: 0, ino: "ino-1", startOffset: 0, duration: 36_000, codec: "aac", mimeType: "audio/mp4" }],
  chapters: [
    { start: 0, end: 1_800, title: "Opening Credits" },
    { start: 1_800, end: 18_000, title: "Chapter 1" },
    { start: 18_000, end: 36_000, title: "2" },
  ],
};

export const MULTI_FILE_BOOK: Book = {
  id: "li_multi",
  libraryId: "lib1",
  title: "Three Parts",
  subtitle: null,
  author: "Bo Writer",
  narrator: null,
  series: [],
  duration: 9_000,
  tracks: [
    { index: 0, ino: "a", startOffset: 0, duration: 3_000, codec: "mp3", mimeType: "audio/mpeg" },
    { index: 1, ino: "b", startOffset: 3_000, duration: 3_000, codec: "mp3", mimeType: "audio/mpeg" },
    { index: 2, ino: "c", startOffset: 6_000, duration: 3_000, codec: "mp3", mimeType: "audio/mpeg" },
  ],
  chapters: [
    { start: 0, end: 2_000, title: "One" },
    { start: 2_000, end: 4_500, title: "Two" },
    { start: 4_500, end: 9_000, title: "Three" },
  ],
};
