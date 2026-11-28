import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MicVocal, Music, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { useI18n } from "../i18n";
import { Alert, Badge, IconButton, ProgressBar, Slider } from "../components/ui";
import { roomApi, type AlexaRoom } from "./roomApi";
import {
  bookSeekSeconds, clockDuration, liveBookPosition, livePosition, roomArtSource, roomCanSeek, roomSource, roomVolume, type PendingControl, type RoomDisplay, type RoomSource,
} from "./roomState";
import { useNow, type RoomCommand } from "./useRoomState";

/** The skills' names as set in YTZERO_ALEXA_*_INVOCATION, written as a name ("hoban music" is Hoban Music). */
export type SkillNames = { music: string | null; video: string | null; books: string | null; movies?: string | null };

export function skillName(invocation: string | null | undefined): string | null {
  if (!invocation) return null;
  return invocation.replace(/(^|\s)(\p{Ll})/gu, (_, space: string, letter: string) => space + letter.toUpperCase());
}

export function SourceBadge({ source, names }: { source: RoomSource; names: SkillNames }) {
  const { t } = useI18n();
  const label = source.kind === "music" ? names.music ?? t("roomSourceMusic")
    : source.kind === "video" ? names.video ?? t("roomSourceVideo")
    : source.kind === "books" ? names.books ?? t("roomSourceBooks")
    : source.kind === "movies" ? names.movies ?? t("roomSourceMovies")
    : source.source ?? t("roomSourceEcho");
  return <Badge variant={source.kind === "home-assistant" ? "neutral" : "accent"} className="room-now__badge">{label}</Badge>;
}

function RoomArt({ url }: { url: string | null | undefined }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const source = roomArtSource(url);
  if (!source || failed) return <span className="room-now__art room-now__art--empty" aria-hidden="true"><Music /></span>;
  return <img className="room-now__art" src={source} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

/** After a key press on the bar, how long to wait for another before jumping: each jump is a command typed to the Echo. */
const KEY_SEEK_WAIT_MS = 800;

/**
 * The song's, video's or chapter's progress. Where playback can move, it is a
 * slider: dragging shows the place, and letting go sends one jump. Until the
 * Echo gets there, the bar stays at the place asked for.
 */
function RoomProgress({ current, receivedAt, onSeek, pendingMs }: {
  current: NonNullable<AlexaRoom["current"]>; receivedAt: number;
  /** Jumps to a place, in the bar's milliseconds; absent where playback can't move. */
  onSeek?: (ms: number) => void;
  pendingMs?: number;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<number | null>(null);
  const draftRef = useRef<number | null>(null);
  const keyTimer = useRef<number | null>(null);
  const now = useNow(1000, current.state === "playing" && draft === null);
  useEffect(() => () => { if (keyTimer.current !== null) window.clearTimeout(keyTimer.current); }, []);
  const position = livePosition(current, receivedAt, now);
  if (!position) return null;
  const max = position.durationMs ?? Math.max(position.positionMs, 1);
  const shown = draft ?? pendingMs ?? position.positionMs;
  const change = (value: number) => { draftRef.current = value; setDraft(value); };
  const commit = () => {
    if (keyTimer.current !== null) { window.clearTimeout(keyTimer.current); keyTimer.current = null; }
    const value = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (value !== null && onSeek) onSeek(value);
  };
  const commitSoon = () => {
    if (keyTimer.current !== null) window.clearTimeout(keyTimer.current);
    keyTimer.current = window.setTimeout(commit, KEY_SEEK_WAIT_MS);
  };
  return <div className={`room-now__progress${onSeek ? " room-now__progress--seek" : ""}`}>
    {onSeek
      ? <Slider min={0} max={max} step={1000} value={Math.min(shown, max)} onChange={change} onPointerUp={commit} onTouchEnd={commit} onKeyUp={commitSoon}
        aria-label={t("roomSeek")} aria-valuetext={clockDuration(shown)} aria-busy={pendingMs !== undefined || undefined} />
      : <ProgressBar value={position.positionMs} max={max} label={t("roomProgress")} />}
    <div className="room-now__times">
      <span>{clockDuration(shown)}</span>
      <span>{position.durationMs ? clockDuration(position.durationMs) : ""}</span>
    </div>
  </div>;
}

/** A book's chapter and its place in the whole book, under the chapter's own progress bar. */
function RoomBookProgress({ current, receivedAt }: { current: NonNullable<AlexaRoom["current"]>; receivedAt: number }) {
  const { t } = useI18n();
  const now = useNow(1000, current.state === "playing");
  const book = current.book;
  const position = liveBookPosition(current, receivedAt, now);
  if (!book || !position) return null;
  const chapter = book.chapterIndex !== null
    ? t("roomBookChapterOf", { chapter: book.chapterTitle || String(book.chapterIndex + 1), number: book.chapterIndex + 1, count: book.chapterCount })
    : null;
  return <div className="room-now__book">
    {chapter ? <p className="room-now__chapter">{chapter}</p> : null}
    <ProgressBar value={position.positionMs} max={Math.max(position.durationMs, 1)} label={t("roomBookProgress")} />
    <div className="room-now__times">
      <span>{t("roomBookPosition", { position: clockDuration(position.positionMs), duration: clockDuration(position.durationMs) })}</span>
      <span>{t("roomBookLeft", { time: clockDuration(position.leftMs) })}</span>
    </div>
  </div>;
}

/** The volume slider: shows the level being set until the Echo reports it, and sends once the finger rests. */
function RoomVolume({ room, control, onVolume }: { room: AlexaRoom | null; control: PendingControl | null; onVolume: (volume: number) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const reported = roomVolume(room);
  const waiting = control?.action === "volume" ? control.volume ?? null : null;
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  useEffect(() => { if (waiting === null && draft !== null && timer.current === null) setDraft(null); }, [draft, waiting]);
  const value = draft ?? waiting ?? reported ?? 5;
  const change = (next: number) => {
    setDraft(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; onVolume(next); }, 350);
  };
  const Icon = value === 0 ? VolumeX : value < 5 ? Volume1 : Volume2;
  return <div className={`room-now__volume${waiting !== null ? " room-now__volume--busy" : ""}`}>
    <Icon aria-hidden="true" />
    <Slider min={0} max={10} step={1} value={value} onChange={change} aria-label={t("roomVolume")} aria-busy={waiting !== null || undefined} />
    <span className="room-now__volume-value">{value}</span>
  </div>;
}

/** Below this, a cover above the title is too small to make out: it moves beside the title instead. */
const COVER_MIN_PX = 110;

/**
 * Whether the cover goes beside the title. In landscape the cover takes the
 * height the text and controls leave, which a long title or an alert can
 * shrink to nothing; then it moves beside the title, as tall as the title
 * block. Measured again when the song, the panel's size or what it shows changes.
 */
function useCoverBeside(layoutKey: string) {
  const panel = useRef<HTMLElement>(null);
  const [beside, setBeside] = useState(false);
  const [resized, setResized] = useState(0);
  useEffect(() => {
    const element = panel.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let last = "";
    const observer = new ResizeObserver(([entry]) => {
      const size = `${Math.round(entry.contentRect.width)}x${Math.round(entry.contentRect.height)}`;
      if (size !== last) { last = size; setResized((count) => count + 1); }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { setBeside(false); }, [layoutKey, resized]);
  useLayoutEffect(() => {
    if (beside) return;
    const box = panel.current?.querySelector<HTMLElement>(".room-now__art-box");
    if (box && window.matchMedia("(orientation: landscape)").matches && box.clientHeight < COVER_MIN_PX) setBeside(true);
  });
  return { panel, beside };
}

export function RoomNowPlaying({ roomName, room, display, control, receivedAt, names, onCommand, lyrics, onLyrics, onOpenArt }: {
  roomName: string;
  room: AlexaRoom | null;
  display: RoomDisplay;
  control: PendingControl | null;
  receivedAt: number;
  names: SkillNames;
  onCommand: RoomCommand;
  /** Whether lyrics mode is on, and how to switch it. */
  lyrics: boolean;
  onLyrics: (on: boolean) => void;
  /** Opens what's playing (its album, or its book) below, when there is one: the cover is then a button. */
  onOpenArt?: { label: string; open: () => void };
}) {
  const { t } = useI18n();
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (!failure) return;
    const timer = window.setTimeout(() => setFailure(null), 8000);
    return () => window.clearTimeout(timer);
  }, [failure]);

  /** `shown` is what the page shows while waiting: the volume, or for a seek the place on the bar. */
  const send = (action: "pause" | "resume" | "next" | "previous" | "skip" | "seek" | "volume", amount?: number, shown?: number) => {
    setFailure(null);
    const body = action === "volume" ? { action, volume: amount ?? 5 }
      : action === "skip" ? { action, seconds: amount ?? 30 }
      : action === "seek" ? { action, seconds: amount ?? 0 }
      : { action };
    void onCommand(roomName, action, () => roomApi.control(roomName, body), action === "volume" ? amount : shown).then((error) => {
      if (error) setFailure(t("roomCommandFailed", { room: roomName, error }));
    });
  };

  const item = display.kind === "starting" ? display.item : display.kind === "idle" ? null : display.current;
  const source = display.kind === "starting" ? roomSource(display.item.skill)
    : display.kind === "idle" ? null : roomSource(display.current.origin, display.current.source);
  const playing = display.kind === "playing" || display.kind === "starting";
  const toggleBusy = control?.action === "pause" || control?.action === "resume";
  // A book: next and previous are chapters, with skips of 30 seconds either side of play.
  const book = source?.kind === "books";
  const current = display.kind === "playing" || display.kind === "paused" ? display.current : null;
  const pendingMs = control?.action === "seek" ? control.target : undefined;
  // A book's bar is its chapter's; the skill jumps to a place in the whole book.
  const seek = current && roomCanSeek(room, current)
    ? (ms: number) => send("seek", book && current.book ? bookSeekSeconds(current.book, ms) : Math.round(ms / 1000), ms)
    : undefined;
  // Books have it too: lyrics mode stays on across rooms, and a book's room needs a way out of it.
  const lyricsButton = <IconButton size="xl" variant={lyrics ? "primary" : "ghost"} aria-pressed={lyrics} label={t("musicLyrics")} icon={<MicVocal />} onClick={() => onLyrics(!lyrics)} />;
  const { panel, beside } = useCoverBeside([item?.title, item?.artist, display.kind, control?.action === "play", failure].join(""));

  return <section ref={panel} className={`room-now${beside ? " room-now--cover-beside" : ""}`} aria-label={t("roomNowPlaying")} aria-live="polite">
    {onOpenArt
      ? <button type="button" className="room-now__art-box room-now__art-open" aria-label={onOpenArt.label} onClick={onOpenArt.open}><RoomArt url={item?.art} /></button>
      : <div className="room-now__art-box"><RoomArt url={item?.art} /></div>}
    <div className="room-now__copy">
      <div className="room-now__badges">
        {source ? <SourceBadge source={source} names={names} /> : null}
        {display.kind === "starting" || control?.action === "play" ? <Badge variant="warning" className="room-now__badge">{t("roomStarting")}</Badge> : null}
        {display.kind === "paused" && control?.action !== "play" ? <Badge className="room-now__badge">{t("roomPaused")}</Badge> : null}
      </div>
      <h1 className="room-now__title">{item?.title || t("roomNothingPlaying")}</h1>
      {item?.artist ? <p className="room-now__artist">{item.artist}</p> : null}
      {current ? <RoomProgress current={current} receivedAt={receivedAt} onSeek={seek} pendingMs={pendingMs} /> : null}
      {book && (display.kind === "playing" || display.kind === "paused") ? <RoomBookProgress current={display.current} receivedAt={receivedAt} /> : null}
    </div>
    <div className={`room-now__controls${book ? " room-now__controls--book" : ""}`}>
      {book ? <>
        <IconButton size="xl" variant="ghost" busy={control?.action === "previous"} label={t("roomPreviousChapter")} icon={<SkipBack />} onClick={() => send("previous")} />
        <IconButton size="xl" variant="secondary" busy={control?.action === "skip"} label={t("roomSkipBack")} icon={<RotateCcw />} onClick={() => send("skip", -30)} />
      </> : null}
      {!book ? <IconButton size="xl" variant="secondary" busy={control?.action === "previous"} label={t("roomPrevious")} icon={<SkipBack />} onClick={() => send("previous")} /> : null}
      <IconButton size="xl" variant="primary" busy={toggleBusy}
        label={playing ? t("roomPause") : t("roomResume")} icon={playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        onClick={() => send(playing ? "pause" : "resume")} />
      {book ? <>
        <IconButton size="xl" variant="secondary" busy={control?.action === "skip"} label={t("roomSkipForward")} icon={<RotateCw />} onClick={() => send("skip", 30)} />
        <IconButton size="xl" variant="ghost" busy={control?.action === "next"} label={t("roomNextChapter")} icon={<SkipForward />} onClick={() => send("next")} />
        {lyricsButton}
      </> : <>
        <IconButton size="xl" variant="secondary" busy={control?.action === "next"} label={t("roomNext")} icon={<SkipForward />} onClick={() => send("next")} />
        {lyricsButton}
      </>}
    </div>
    <RoomVolume room={room} control={control} onVolume={(volume) => send("volume", volume)} />
    {failure ? <Alert variant="danger" role="alert" className="room-now__failure">{failure}</Alert> : null}
  </section>;
}
