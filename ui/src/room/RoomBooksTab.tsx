import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BookOpen, ListOrdered, Play } from "lucide-react";
import { useI18n } from "../i18n";
import { Alert, Button, EmptyState, List, ListRow, MenuLoading, ProgressBar, SectionHeader, SelectMenu } from "../components/ui";
import { MusicArtwork, MusicCard, MusicDetailHeader, MusicNote, useMusicData } from "../music/MusicParts";
import { roomBooksApi, type RoomBook, type RoomBookSummary, type RoomCurrent, type RoomLibrarySort } from "./roomApi";
import { clockDuration, roomPath } from "./roomState";
import type { RoomCommand } from "./useRoomState";
import { RoomSearchBox } from "./RoomSearchBox";
import "./RoomBooksTab.css";

/** "10 h 4 min": a book's length, which runs to many hours. */
function bookLength(seconds: number, t: ReturnType<typeof useI18n>["t"]): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? t("roomBookHoursMinutes", { hours, minutes: minutes % 60 }) : t("roomBookMinutes", { minutes });
}

function BookCard({ book, onOpen }: { book: RoomBookSummary; onOpen: (book: RoomBookSummary) => void }) {
  const { t } = useI18n();
  const detail = book.progress?.isFinished ? t("roomBookFinished")
    : book.progress && book.progress.progress > 0 ? t("roomBookPercent", { percent: Math.round(book.progress.progress * 100) })
    : book.author;
  return <div className="room-books__card">
    <MusicCard art={<MusicArtwork url={roomBooksApi.coverUrl(book.id)} />} title={book.title} detail={detail} onOpen={() => onOpen(book)} />
    {book.progress && !book.progress.isFinished && book.progress.progress > 0
      ? <ProgressBar value={book.progress.progress} max={1} label={t("roomBookProgress")} className="room-books__card-progress" /> : null}
  </div>;
}

/** Starting a book in the room: queues it for the room and has the Echo play it, shown as pending until it does. */
function useRoomBook(roomName: string, onCommand: RoomCommand) {
  const { t } = useI18n();
  const [failure, setFailure] = useState<string | null>(null);
  const play = useCallback((bookId: string, chapter?: number) => {
    setFailure(null);
    void onCommand(roomName, "play", async () => {
      const answer = await roomBooksApi.play(roomName, { bookId, ...(chapter === undefined ? {} : { chapter }) });
      if (answer.error) throw new Error(answer.error);
    }).then((error) => { if (error) setFailure(t("roomCommandFailed", { room: roomName, error })); });
  }, [onCommand, roomName, t]);
  return { play, failure };
}

function BookView({ bookId, roomName, play, playingChapter }: {
  bookId: string; roomName: string; play: (bookId: string, chapter?: number) => void;
  /** The chapter the room's Echo is playing, when it plays this book. */
  playingChapter: number | null;
}) {
  const { t } = useI18n();
  const book = useMusicData(useCallback(() => roomBooksApi.book(bookId), [bookId]));
  if (book.failed) return <MusicNote text={t("roomBooksLoadFailed")} onRetry={book.retry} />;
  if (!book.data) return <MenuLoading label={t("loading")} />;
  const data: RoomBook = book.data;
  const saved = data.progress && !data.progress.isFinished && data.progress.currentTime > 0 ? data.progress.currentTime : null;
  const series = data.series.map((item) => item.sequence ? `${item.name} #${item.sequence}` : item.name).join(", ");
  const current = playingChapter ?? (saved === null ? -1 : data.chapters.reduce((found, chapter, index) => chapter.start <= saved ? index : found, -1));
  return <>
    <MusicDetailHeader art={roomBooksApi.coverUrl(data.id)} title={data.title}
      detail={[data.author, series, bookLength(data.duration, t)].filter(Boolean).join(" · ")}>
      <Button size="lg" variant="primary" leadingIcon={<Play />} onClick={() => play(data.id)}>
        {saved === null ? t("roomPlayIn", { room: roomName }) : t("roomBookResumeIn", { room: roomName, time: clockDuration(saved * 1000) })}
      </Button>
    </MusicDetailHeader>
    {data.chapters.length ? <section className="music-shelf">
      <SectionHeader title={t("roomBookChapters")} level={2} description={t("roomBookChaptersHint", { room: roomName })} />
      <List className="room-books__chapters">
        {data.chapters.map((chapter) => <ListRow key={chapter.index} className={`room-books__chapter${chapter.index === current ? " room-books__chapter--current" : ""}`}
          title={chapter.title || t("roomBookChapterNumber", { number: chapter.index + 1 })}
          description={[clockDuration(chapter.start * 1000), bookLength(chapter.end - chapter.start, t), chapter.index === current ? t("roomBookYouAreHere") : null].filter(Boolean).join(" · ")}
          actions={<Button size="lg" leadingIcon={<Play />} onClick={() => play(data.id, chapter.index)}>{t("roomPlayIn", { room: roomName })}</Button>} />)}
      </List>
    </section> : null}
  </>;
}

const LIBRARY_SORTS: readonly RoomLibrarySort[] = ["newest", "random", "title"];

/**
 * The library, a page at a time. "Show more" adds the next page to what is
 * shown rather than loading it all again, so a shuffle stays as it was; each
 * page of a shuffle is shuffled afresh by Audiobookshelf, so a book already
 * shown is left out.
 */
function LibraryShelf({ query, sort, onSort, onOpen }: {
  query: string; sort: RoomLibrarySort; onSort: (sort: RoomLibrarySort) => void; onOpen: (book: RoomBookSummary) => void;
}) {
  const { t } = useI18n();
  const first = useMusicData(useCallback(() => roomBooksApi.library(query, 0, sort), [query, sort]));
  const [more, setMore] = useState<{ pages: number; books: RoomBookSummary[]; loading: boolean; failed: boolean }>({ pages: 1, books: [], loading: false, failed: false });
  useEffect(() => setMore({ pages: 1, books: [], loading: false, failed: false }), [query, sort]);
  const showMore = () => {
    setMore((state) => ({ ...state, loading: true, failed: false }));
    roomBooksApi.library("", more.pages, sort).then(
      (page) => setMore((state) => ({ pages: state.pages + 1, books: [...state.books, ...page.books], loading: false, failed: false })),
      () => setMore((state) => ({ ...state, loading: false, failed: true })));
  };
  if (first.failed) return <MusicNote text={t("roomBooksLoadFailed")} onRetry={first.retry} />;
  if (!first.data) return <MenuLoading label={t("loading")} />;
  const seen = new Set<string>();
  const books = [...first.data.books, ...(query ? [] : more.books)].filter((book) => !seen.has(book.id) && Boolean(seen.add(book.id)));
  const hasMore = !query && more.pages * first.data.pageSize < first.data.total;
  return <section className="music-shelf">
    <SectionHeader title={query ? t("roomVideoResults", { query }) : t("roomBooksLibrary")} level={2}
      actions={query ? undefined : <SelectMenu size="lg" floating label={t("roomBooksSort")} value={sort} onChange={onSort}
        options={LIBRARY_SORTS.map((value) => ({ value, label: t(`roomBooksSort_${value}`) }))} />} />
    {!books.length ? <EmptyState compact icon={<BookOpen />} title={query ? t("roomBooksNoResults") : t("roomBooksEmpty")} />
      : <div className="room-books__grid">{books.map((book) => <BookCard key={book.id} book={book} onOpen={onOpen} />)}</div>}
    {more.failed ? <MusicNote text={t("roomBooksLoadFailed")} onRetry={showMore} /> : null}
    {hasMore ? <Button size="lg" className="room-books__more" busy={more.loading} onClick={showMore}>{t("roomBooksMore")}</Button> : null}
  </section>;
}

/** The book playing in the room, as its queue: tapping it opens the chapters to jump to one. */
function PlayingBookCard({ roomName, current, onOpen }: { roomName: string; current: RoomCurrent; onOpen: () => void }) {
  const { t } = useI18n();
  const book = current.book!;
  const chapter = book.chapterIndex !== null ? t("roomBookChapterOf", { chapter: book.chapterTitle || String(book.chapterIndex + 1), number: book.chapterIndex + 1, count: book.chapterCount }) : null;
  return <div className="room-music__queue">
    <button type="button" className="room-music__queue-open" onClick={onOpen} aria-label={t("roomBookChaptersOpen", { title: current.title ?? "" })}>
      <ListOrdered aria-hidden="true" />
      <span className="room-music__queue-copy">
        <span className="room-music__queue-label">{t("roomBookPlayingIn", { room: roomName })}</span>
        <span className="room-music__queue-title">{current.title}</span>
        <span className="room-music__queue-detail">{[chapter, t("roomBookChaptersJump")].filter(Boolean).join(" · ")}</span>
      </span>
    </button>
  </div>;
}

/**
 * Hoban Books for the room: books in progress, the library with search and
 * covers, and a book's chapters, each of which can start on the room's Echo.
 * A book starts by being queued for the room, then "ask hoban books to play
 * my book" is typed to the Echo, the way the music tab's queue works.
 */
export function RoomBooksTab({ roomName, homeRoom, path, onCommand, current }: {
  roomName: string; homeRoom: string; path: string[]; onCommand: RoomCommand;
  /** What the room plays now, when it's a book. */
  current: RoomCurrent | null;
}) {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const query = params.get("q")?.trim() ?? "";
  // The order is in the address, so going back to the library keeps it. Newest first unless chosen.
  const asked = params.get("sort") as RoomLibrarySort | null;
  const sort: RoomLibrarySort = asked && LIBRARY_SORTS.includes(asked) ? asked : "newest";
  const chooseSort = (next: RoomLibrarySort) => navigate(`${roomPath(homeRoom, "books")}${next === "newest" ? "" : `?sort=${next}`}`, { replace: true });
  const status = useMusicData(roomBooksApi.status);
  const continuing = useMusicData(roomBooksApi.continueListening);
  const { play, failure } = useRoomBook(roomName, onCommand);
  const open = (book: RoomBookSummary) => navigate(roomPath(homeRoom, `books/book/${encodeURIComponent(book.id)}`));
  const search = (text: string) => navigate(`${roomPath(homeRoom, "books")}${text ? `?q=${encodeURIComponent(text)}` : ""}`);

  if (status.data && !status.data.enabled) return <EmptyState icon={<BookOpen />} title={t("roomBooksOff")} description={t("roomBooksOffHint")} />;
  const alert = failure ? <Alert variant="danger" role="alert" className="room-tab__failure">{failure}</Alert> : null;
  const playing = current?.origin === "books" && current.book && current.state !== "finished" ? current : null;
  if (path[0] === "book" && path[1]) {
    const chapter = playing?.book?.bookId === path[1] ? playing.book.chapterIndex : null;
    return <div className="room-books">{alert}<BookView bookId={path[1]} roomName={roomName} play={play} playingChapter={chapter} /></div>;
  }
  return <div className="room-books">
    <RoomSearchBox value={query} placeholder={t("roomBooksSearchPlaceholder")} onSearch={search} />
    <p className="room-music__hint">{t("roomBooksHint", { room: roomName })}</p>
    {alert}
    {playing ? <PlayingBookCard roomName={roomName} current={playing} onOpen={() => navigate(roomPath(homeRoom, `books/book/${encodeURIComponent(playing.book!.bookId)}`))} /> : null}
    {!query && continuing.data?.length ? <section className="music-shelf">
      <SectionHeader title={t("roomVideosContinue")} level={2} />
      <div className="music-shelf__row">{continuing.data.map((book) => <BookCard key={book.id} book={book} onOpen={open} />)}</div>
    </section> : null}
    {status.data?.enabled ? <LibraryShelf query={query} sort={sort} onSort={chooseSort} onOpen={open} /> : status.failed ? <MusicNote text={t("roomBooksLoadFailed")} onRetry={status.retry} /> : null}
  </div>;
}
