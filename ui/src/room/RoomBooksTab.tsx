import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BookOpen, Play } from "lucide-react";
import { useI18n } from "../i18n";
import { Alert, Button, EmptyState, List, ListRow, MenuLoading, ProgressBar, SectionHeader } from "../components/ui";
import { MusicArtwork, MusicCard, MusicDetailHeader, MusicNote, useMusicData } from "../music/MusicParts";
import { roomBooksApi, type RoomBook, type RoomBookSummary } from "./roomApi";
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

function BookView({ bookId, roomName, play }: { bookId: string; roomName: string; play: (bookId: string, chapter?: number) => void }) {
  const { t } = useI18n();
  const book = useMusicData(useCallback(() => roomBooksApi.book(bookId), [bookId]));
  if (book.failed) return <MusicNote text={t("roomBooksLoadFailed")} onRetry={book.retry} />;
  if (!book.data) return <MenuLoading label={t("loading")} />;
  const data: RoomBook = book.data;
  const saved = data.progress && !data.progress.isFinished && data.progress.currentTime > 0 ? data.progress.currentTime : null;
  const series = data.series.map((item) => item.sequence ? `${item.name} #${item.sequence}` : item.name).join(", ");
  const current = saved === null ? -1 : data.chapters.reduce((found, chapter, index) => chapter.start <= saved ? index : found, -1);
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

function LibraryShelf({ query, onOpen }: { query: string; onOpen: (book: RoomBookSummary) => void }) {
  const { t } = useI18n();
  const [pages, setPages] = useState(1);
  const first = useMusicData(useCallback(() => roomBooksApi.library(query, 0), [query]));
  const more = useMusicData(useCallback(async () => {
    const loaded: RoomBookSummary[] = [];
    for (let page = 1; page < pages; page++) loaded.push(...(await roomBooksApi.library("", page)).books);
    return loaded;
  }, [pages]));
  if (first.failed) return <MusicNote text={t("roomBooksLoadFailed")} onRetry={first.retry} />;
  if (!first.data) return <MenuLoading label={t("loading")} />;
  const books = [...first.data.books, ...(query ? [] : more.data ?? [])];
  const hasMore = !query && books.length < first.data.total;
  return <section className="music-shelf">
    <SectionHeader title={query ? t("roomVideoResults", { query }) : t("roomBooksLibrary")} level={2} />
    {!books.length ? <EmptyState compact icon={<BookOpen />} title={query ? t("roomBooksNoResults") : t("roomBooksEmpty")} />
      : <div className="room-books__grid">{books.map((book) => <BookCard key={book.id} book={book} onOpen={onOpen} />)}</div>}
    {hasMore ? <Button size="lg" className="room-books__more" onClick={() => setPages((count) => count + 1)}>{t("roomBooksMore")}</Button> : null}
  </section>;
}

/**
 * Hoban Books for the room: books in progress, the library with search and
 * covers, and a book's chapters, each of which can start on the room's Echo.
 * A book starts by being queued for the room, then "ask hoban books to play
 * my book" is typed to the Echo, the way the music tab's queue works.
 */
export function RoomBooksTab({ roomName, homeRoom, path, onCommand }: { roomName: string; homeRoom: string; path: string[]; onCommand: RoomCommand }) {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search).get("q")?.trim() ?? "";
  const status = useMusicData(roomBooksApi.status);
  const continuing = useMusicData(roomBooksApi.continueListening);
  const { play, failure } = useRoomBook(roomName, onCommand);
  const open = (book: RoomBookSummary) => navigate(roomPath(homeRoom, `books/book/${encodeURIComponent(book.id)}`));
  const search = (text: string) => navigate(`${roomPath(homeRoom, "books")}${text ? `?q=${encodeURIComponent(text)}` : ""}`);

  if (status.data && !status.data.enabled) return <EmptyState icon={<BookOpen />} title={t("roomBooksOff")} description={t("roomBooksOffHint")} />;
  const alert = failure ? <Alert variant="danger" role="alert" className="room-tab__failure">{failure}</Alert> : null;
  if (path[0] === "book" && path[1]) return <div className="room-books">{alert}<BookView bookId={path[1]} roomName={roomName} play={play} /></div>;
  return <div className="room-books">
    <RoomSearchBox value={query} placeholder={t("roomBooksSearchPlaceholder")} onSearch={search} />
    <p className="room-music__hint">{t("roomBooksHint", { room: roomName })}</p>
    {alert}
    {!query && continuing.data?.length ? <section className="music-shelf">
      <SectionHeader title={t("roomVideosContinue")} level={2} />
      <div className="music-shelf__row">{continuing.data.map((book) => <BookCard key={book.id} book={book} onOpen={open} />)}</div>
    </section> : null}
    {status.data?.enabled ? <LibraryShelf query={query} onOpen={open} /> : status.failed ? <MusicNote text={t("roomBooksLoadFailed")} onRetry={status.retry} /> : null}
  </div>;
}
