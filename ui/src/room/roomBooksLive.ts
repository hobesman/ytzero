import type { RoomBookSummary, RoomCurrent } from "./roomApi";

/** How often "Continue listening" is fetched again while a book plays in the room. */
export const CONTINUE_REFRESH_MS = 60_000;
/** After a book stops, how long to wait for the skill to save its place before fetching again. */
export const CONTINUE_AFTER_STOP_MS = 3_000;

/**
 * "Continue listening" with the room's book at the front, at the place it has
 * reached now. The Echo reports a book's place only when it stops, so until
 * then Audiobookshelf still holds where it started.
 */
export function withPlayingBook(books: readonly RoomBookSummary[], current: RoomCurrent | null): RoomBookSummary[] {
  const live = current?.origin === "books" && current.state !== "finished" ? current.book : null;
  if (!live || live.bookDurationMs <= 0) return [...books];
  const known = books.find((book) => book.id === live.bookId);
  const currentTime = live.bookPositionMs / 1000;
  const playing: RoomBookSummary = {
    ...(known ?? {
      id: live.bookId, libraryId: "", title: current!.title ?? "", author: live.author,
      seriesName: null, duration: live.bookDurationMs / 1000, numChapters: live.chapterCount,
    }),
    progress: { currentTime, progress: Math.min(1, live.bookPositionMs / live.bookDurationMs), isFinished: false },
  };
  return [playing, ...books.filter((book) => book.id !== live.bookId)];
}
