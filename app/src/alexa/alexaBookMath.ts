import type { Book, BookChapter } from "../audiobookshelf/audiobookshelfClient";

/**
 * Positions in a book. An Echo plays one audio file at a time and reports
 * where it is in that file; Audiobookshelf, chapters and the tablet count
 * from the start of the whole book. Everything here is in seconds.
 */

/** Where a place in the book is: which file, and how far into it. */
export interface BookPlace { fileIndex: number; offset: number }

/** Leaves room to hear something at the end of a book or file. */
const END_MARGIN_SECONDS = 1;

/** The file holding `position` (clamped to the book), and how far into that file it is. */
export function placeInBook(book: Pick<Book, "tracks">, position: number): BookPlace {
  const { tracks } = book;
  const last = tracks.length - 1;
  const end = tracks[last]!.startOffset + tracks[last]!.duration;
  const at = Math.min(Math.max(0, position), Math.max(0, end - END_MARGIN_SECONDS));
  let index = 0;
  for (let i = 0; i < tracks.length; i++) if (tracks[i]!.startOffset <= at) index = i;
  return { fileIndex: index, offset: Math.max(0, at - tracks[index]!.startOffset) };
}

/** The place in the whole book of `offset` seconds into file `fileIndex`. */
export function bookPosition(book: Pick<Book, "tracks">, fileIndex: number, offset: number): number {
  const track = book.tracks[Math.min(Math.max(0, fileIndex), book.tracks.length - 1)]!;
  return track.startOffset + Math.min(Math.max(0, offset), track.duration);
}

/**
 * The book's chapters, or its files when it has none: a book in many files
 * with no chapter marks is usually one file a chapter.
 */
export function chaptersOf(book: Pick<Book, "chapters" | "tracks">): BookChapter[] {
  if (book.chapters.length) return book.chapters;
  if (book.tracks.length < 2) return [];
  return book.tracks.map((track) => ({ start: track.startOffset, end: track.startOffset + track.duration, title: `Part ${track.index + 1}` }));
}

/** The chapter holding `position`, with its place in the list, or null for a book with no chapters. */
export function chapterAt(book: Pick<Book, "chapters" | "tracks">, position: number): { index: number; chapter: BookChapter } | null {
  const chapters = chaptersOf(book);
  if (!chapters.length) return null;
  let index = 0;
  for (let i = 0; i < chapters.length; i++) if (chapters[i]!.start <= position + 0.01) index = i;
  return { index, chapter: chapters[index]! };
}

/** Where the next chapter starts, or null in the last one. */
export function nextChapterStart(book: Pick<Book, "chapters" | "tracks">, position: number): number | null {
  const current = chapterAt(book, position);
  if (!current) return null;
  return chaptersOf(book)[current.index + 1]?.start ?? null;
}

/** Where the previous chapter starts; in the first chapter, where that one starts. Null with no chapters. */
export function previousChapterStart(book: Pick<Book, "chapters" | "tracks">, position: number): number | null {
  const current = chapterAt(book, position);
  if (!current) return null;
  return chaptersOf(book)[Math.max(0, current.index - 1)]!.start;
}

/** How much of the chapter and the book is left after `position`. */
export function timeLeft(book: Pick<Book, "chapters" | "tracks" | "duration">, position: number): { chapter: number | null; book: number } {
  const current = chapterAt(book, position);
  return {
    chapter: current ? Math.max(0, current.chapter.end - position) : null,
    book: Math.max(0, book.duration - position),
  };
}

/** "3 hours and 12 minutes", "12 minutes", "40 seconds": as Alexa should say a length. */
export function spokenDuration(seconds: number): string {
  const total = Math.round(Math.max(0, seconds));
  if (total < 60) return total === 1 ? "1 second" : `${total} seconds`;
  const minutesTotal = Math.round(total / 60);
  const hours = Math.floor(minutesTotal / 60);
  const minutes = minutesTotal % 60;
  const unit = (count: number, name: string) => `${count} ${name}${count === 1 ? "" : "s"}`;
  if (!hours) return unit(minutes, "minute");
  return minutes ? `${unit(hours, "hour")} and ${unit(minutes, "minute")}` : unit(hours, "hour");
}

/** A chapter's name as Alexa should say it: "Chapter 3" stays, a bare "3" becomes "chapter 3". */
export function spokenChapter(chapter: BookChapter, index: number): string {
  const title = chapter.title.trim();
  if (!title) return `chapter ${index + 1}`;
  return /^\d+$/.test(title) ? `chapter ${title}` : title;
}

/** Where a book should start when asked for: its saved place, unless it was finished or is at the very end. */
export function resumePosition(book: Pick<Book, "duration">, saved: { currentTime: number; isFinished: boolean } | null): number {
  if (!saved || saved.isFinished) return 0;
  return saved.currentTime < book.duration - 30 ? Math.max(0, saved.currentTime) : 0;
}
