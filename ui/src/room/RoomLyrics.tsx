import { useEffect, useRef, useState } from "react";
import { MicVocal } from "lucide-react";
import { useI18n } from "../i18n";
import { Button, EmptyState, MenuLoading } from "../components/ui";
import type { VideoSubtitle } from "../apiTypes";
import { musicApi, type MusicLyrics } from "../music/musicApi";
import { currentLyricIndex } from "../music/musicLyrics";
import { roomBooksApi, type AlexaRoom } from "./roomApi";
import { captionLines, pickCaptions } from "./roomCaptions";
import { liveBookPosition, livePosition, roomLyricsSong, type RoomLyricsSong } from "./roomState";
import { useNow } from "./useRoomState";

/** `captions`: the subtitle language's name, when the lines are a video's subtitles. */
type Loaded = { key: string; lyrics: MusicLyrics | null; failed: boolean; captions?: string };

/** A video's subtitles, in the page's language where it has them, as synced lines. */
async function videoCaptions(videoId: string, locale: string): Promise<{ lyrics: MusicLyrics | null; captions?: string }> {
  // A search result YT Zero doesn't have is a 404: no subtitles to show, not a failure.
  const listed = await fetch(`/api/videos/${encodeURIComponent(videoId)}/subtitles`, { credentials: "same-origin" });
  if (listed.status === 404) return { lyrics: null };
  if (!listed.ok) throw new Error(`subtitles: ${listed.status}`);
  const { subtitles } = await listed.json() as { subtitles: VideoSubtitle[] };
  const track = pickCaptions(subtitles, locale);
  if (!track) return { lyrics: null };
  const response = await fetch(track.url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`subtitles: ${response.status}`);
  const synced = captionLines(await response.text());
  return { lyrics: { videoId, synced: synced.length ? synced : null, plain: null, instrumental: false, source: null }, captions: track.label ?? track.lang };
}

const bookLyrics = (lines: { time: number; text: string }[]): MusicLyrics | null =>
  lines.length ? { videoId: "", synced: lines, plain: null, instrumental: false, source: null } : null;

/**
 * A book's thousands of sentences: only those around the one being read are
 * drawn, in a window that moves a block at a time, so the text doesn't jump
 * a line with every sentence.
 */
const WINDOW_STEP = 40;

/** The song's lyrics, the video's subtitles or the book's text, fetched once per item while lyrics mode is on. */
function useRoomLyrics(song: RoomLyricsSong, locale: string) {
  const key = song?.key ?? null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!song || !key) return;
    let live = true;
    const request = song.kind === "video" ? videoCaptions(song.videoId, locale)
      : song.kind === "book" ? roomBooksApi.readAlong(song.bookId).then((lines) => ({ lyrics: bookLyrics(lines) }))
      : (song.kind === "track" ? musicApi.lyrics(song.videoId) : musicApi.songLyrics(song)).then((lyrics) => ({ lyrics }));
    request.then(
      (result) => { if (live) setLoaded({ key, failed: false, ...result }); },
      () => { if (live) setLoaded({ key, lyrics: null, failed: true }); },
    );
    return () => { live = false; };
    // `song` is keyed by `key`: a new object for the same song needs no new request.
  }, [key, attempt]);
  return { loaded: loaded && loaded.key === key ? loaded : null, retry: () => setAttempt((count) => count + 1) };
}

/** Synced lines: the one being sung is large and bright, kept in the middle, and follows the Echo's position. */
function SyncedLines({ lines, room, receivedAt, book }: { lines: NonNullable<MusicLyrics["synced"]>; room: AlexaRoom; receivedAt: number; book: boolean }) {
  const current = room.current;
  const now = useNow(250, current?.state === "playing");
  // A book's lines are timed in the whole book; the progress bar's position is the chapter's.
  const position = (book ? liveBookPosition(current, receivedAt, now)?.positionMs : livePosition(current, receivedAt, now)?.positionMs) ?? 0;
  const index = currentLyricIndex(lines, position / 1000);
  const from = book ? Math.max(0, (Math.floor(Math.max(0, index) / WINDOW_STEP) - 1) * WINDOW_STEP) : 0;
  const shown = book ? lines.slice(from, from + WINDOW_STEP * 4) : lines;
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scroller.current;
    const line = box?.querySelector<HTMLElement>(`[data-line="${Math.max(0, index)}"]`);
    if (!box || !line) return;
    box.scrollTo({ top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2, behavior: "smooth" });
  }, [index]);
  return <div ref={scroller} className="room-lyrics__scroll room-lyrics__scroll--synced">
    <ol className="room-lyrics__lines">
      {shown.map((line, offset) => ({ line, at: from + offset })).map(({ line, at }) => <li key={`${at}:${line.time}`} data-line={at} className="room-lyrics__line"
        aria-current={at === index ? "true" : undefined} data-past={at < index ? "" : undefined}>{line.text || "♪"}</li>)}
    </ol>
  </div>;
}

/**
 * Lyrics mode: the room's song's lyrics (a video's subtitles) in place of the
 * browser, large enough to read across a kitchen. Synced lyrics follow the Echo; plain ones
 * scroll by hand.
 */
export function RoomLyrics({ room, receivedAt }: { room: AlexaRoom | null; receivedAt: number }) {
  const { t, locale } = useI18n();
  const song = roomLyricsSong(room);
  const { loaded, retry } = useRoomLyrics(song, locale);
  const video = song?.kind === "video";
  const book = song?.kind === "book";
  if (!room || !song) return <EmptyState icon={<MicVocal />} title={t("roomLyricsIdle")} />;
  // A book's text is read out of its EPUB the first time, which takes a while: say so.
  if (!loaded) return <div className="room-lyrics__loading"><MenuLoading label={book ? t("roomBookTextLoading") : t("loading")} /></div>;
  const failedTitle = book ? t("roomBookTextFailed") : video ? t("roomCaptionsFailed") : t("musicLyricsFailed");
  if (loaded.failed) return <EmptyState icon={<MicVocal />} title={failedTitle} action={<Button size="lg" onClick={retry}>{t("musicRetry")}</Button>} />;
  const lyrics = loaded.lyrics;
  const source = loaded.captions ? t("roomCaptionsFrom", { language: loaded.captions })
    : lyrics?.source ? (lyrics.source === "LRCLIB" ? t("musicLyricsFrom", { source: "LRCLIB" }) : lyrics.source) : null;
  if (!lyrics?.synced && !lyrics?.plain) {
    return <EmptyState icon={<MicVocal />} title={book ? t("roomBookTextNone") : video ? t("roomCaptionsNone") : lyrics?.instrumental ? t("musicLyricsInstrumental") : t("musicLyricsNone")} />;
  }
  return <section className="room-lyrics" aria-label={t("musicLyrics")}>
    {lyrics.synced ? <SyncedLines lines={lyrics.synced} room={room} receivedAt={receivedAt} book={book} />
      : <div className="room-lyrics__scroll"><p className="room-lyrics__plain">{lyrics.plain}</p></div>}
    {source ? <p className="room-lyrics__source">{source}</p> : null}
  </section>;
}
