import { useEffect, useRef, useState } from "react";
import { MicVocal } from "lucide-react";
import { useI18n } from "../i18n";
import { Button, EmptyState, MenuLoading } from "../components/ui";
import { musicApi, type MusicLyrics } from "../music/musicApi";
import { currentLyricIndex } from "../music/musicLyrics";
import type { AlexaRoom } from "./roomApi";
import { livePosition, roomLyricsSong, type RoomLyricsSong } from "./roomState";
import { useNow } from "./useRoomState";

type Loaded = { key: string; lyrics: MusicLyrics | null; failed: boolean };

/** The song's lyrics, fetched once per song while lyrics mode is on. */
function useRoomLyrics(song: RoomLyricsSong) {
  const key = song && song.kind !== "video" ? song.key : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!song || song.kind === "video" || !key) return;
    let live = true;
    const request = song.kind === "track" ? musicApi.lyrics(song.videoId) : musicApi.songLyrics(song);
    request.then(
      (lyrics) => { if (live) setLoaded({ key, lyrics, failed: false }); },
      () => { if (live) setLoaded({ key, lyrics: null, failed: true }); },
    );
    return () => { live = false; };
    // `song` is keyed by `key`: a new object for the same song needs no new request.
  }, [key, attempt]);
  return { loaded: loaded && loaded.key === key ? loaded : null, retry: () => setAttempt((count) => count + 1) };
}

/** Synced lines: the one being sung is large and bright, kept in the middle, and follows the Echo's position. */
function SyncedLines({ lines, room, receivedAt }: { lines: NonNullable<MusicLyrics["synced"]>; room: AlexaRoom; receivedAt: number }) {
  const current = room.current;
  const now = useNow(250, current?.state === "playing");
  const position = livePosition(current, receivedAt, now)?.positionMs ?? 0;
  const index = currentLyricIndex(lines, position / 1000);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scroller.current;
    const line = box?.querySelector<HTMLElement>(`[data-line="${Math.max(0, index)}"]`);
    if (!box || !line) return;
    box.scrollTo({ top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2, behavior: "smooth" });
  }, [index]);
  return <div ref={scroller} className="room-lyrics__scroll room-lyrics__scroll--synced">
    <ol className="room-lyrics__lines">
      {lines.map((line, at) => <li key={`${at}:${line.time}`} data-line={at} className="room-lyrics__line"
        aria-current={at === index ? "true" : undefined} data-past={at < index ? "" : undefined}>{line.text || "♪"}</li>)}
    </ol>
  </div>;
}

/**
 * Lyrics mode: the room's song's lyrics in place of the browser, large
 * enough to read across a kitchen. Synced lyrics follow the Echo; plain ones
 * scroll by hand.
 */
export function RoomLyrics({ room, receivedAt }: { room: AlexaRoom | null; receivedAt: number }) {
  const { t } = useI18n();
  const song = roomLyricsSong(room);
  const { loaded, retry } = useRoomLyrics(song);
  if (!room || !song) return <EmptyState icon={<MicVocal />} title={t("roomLyricsIdle")} />;
  if (song.kind === "video") return <EmptyState icon={<MicVocal />} title={t("roomLyricsVideo")} />;
  if (!loaded) return <div className="room-lyrics__loading"><MenuLoading label={t("loading")} /></div>;
  if (loaded.failed) return <EmptyState icon={<MicVocal />} title={t("musicLyricsFailed")} action={<Button size="lg" onClick={retry}>{t("musicRetry")}</Button>} />;
  const lyrics = loaded.lyrics;
  const source = lyrics?.source ? (lyrics.source === "LRCLIB" ? t("musicLyricsFrom", { source: "LRCLIB" }) : lyrics.source) : null;
  if (!lyrics?.synced && !lyrics?.plain) return <EmptyState icon={<MicVocal />} title={lyrics?.instrumental ? t("musicLyricsInstrumental") : t("musicLyricsNone")} />;
  return <section className="room-lyrics" aria-label={t("musicLyrics")}>
    {lyrics.synced ? <SyncedLines lines={lyrics.synced} room={room} receivedAt={receivedAt} />
      : <div className="room-lyrics__scroll"><p className="room-lyrics__plain">{lyrics.plain}</p></div>}
    {source ? <p className="room-lyrics__source">{source}</p> : null}
  </section>;
}
