import { useEffect, useRef, useState } from "react";
import { MicVocal } from "lucide-react";
import { useI18n } from "../i18n";
import { Button, EmptyState, FloatingPopover, IconButton, MenuLoading, ScrollArea } from "../components/ui";
import { musicApi, type MusicLyrics, type MusicTrack } from "./musicApi";
import { currentLyricIndex } from "./musicLyrics";
import { musicPlayer, useMusicPlayer } from "./musicPlayer";
import "./MusicLyricsParts.css";

type Loaded = { videoId: string; lyrics: MusicLyrics | null; failed: boolean };

/** The song's lyrics, fetched once per song while the panel is open. */
function useLyrics(videoId: string, active: boolean) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active || (loaded?.videoId === videoId && !loaded.failed)) return;
    let live = true;
    setLoaded(null);
    musicApi.lyrics(videoId).then(
      (lyrics) => { if (live) setLoaded({ videoId, lyrics, failed: false }); },
      () => { if (live) setLoaded({ videoId, lyrics: null, failed: true }); },
    );
    return () => { live = false; };
    // `loaded` is left out on purpose: a result for this song ends the effect's work.
  }, [active, videoId, attempt]);
  return { loaded: loaded?.videoId === videoId ? loaded : null, retry: () => setAttempt((count) => count + 1) };
}

/** Time-synced lines: the one being sung is highlighted and kept in view; a line can be clicked to jump to it. */
function SyncedLyrics({ lines }: { lines: NonNullable<MusicLyrics["synced"]> }) {
  const { position } = useMusicPlayer();
  const index = currentLyricIndex(lines, position);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = viewport.current;
    const line = scroller?.querySelector<HTMLElement>(`[data-line="${Math.max(0, index)}"]`);
    if (!scroller || !line) return;
    scroller.scrollTo({ top: line.offsetTop - scroller.clientHeight / 2 + line.clientHeight / 2, behavior: "smooth" });
  }, [index]);
  return <ScrollArea ref={viewport} viewportClassName="music-lyrics__scroll">
    <ol className="music-lyrics__lines">
      {lines.map((line, at) => <li key={`${at}:${line.time}`} data-line={at}>
        <button type="button" className="music-lyrics__line" aria-current={at === index ? "true" : undefined} data-past={at < index ? "" : undefined}
          onClick={() => musicPlayer.seek(line.time)}>{line.text || "♪"}</button>
      </li>)}
    </ol>
  </ScrollArea>;
}

/** The player bar's Lyrics: synced to the song when the lyrics have timings, otherwise as plain text. */
export function MusicLyricsButton({ track }: { track: MusicTrack }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { loaded, retry } = useLyrics(track.videoId, open);
  const lyrics = loaded?.lyrics ?? null;
  const source = lyrics?.source ? (lyrics.source === "LRCLIB" ? t("musicLyricsFrom", { source: "LRCLIB" }) : lyrics.source) : null;
  const trigger = <IconButton variant="ghost" label={t("musicLyrics")} aria-pressed={open} icon={<MicVocal />} />;
  return <FloatingPopover open={open} onOpenChange={setOpen} align="end" trigger={trigger}>
    <section className="music-lyrics" aria-label={t("musicLyrics")}>
      <div className="ui-popover__title">{t("musicLyrics")}</div>
      {!loaded ? <MenuLoading label={t("loading")} />
        : loaded.failed ? <EmptyState compact icon={<MicVocal />} title={t("musicLyricsFailed")} action={<Button onClick={retry}>{t("musicRetry")}</Button>} />
        : lyrics?.synced ? <SyncedLyrics lines={lyrics.synced} />
        : lyrics?.plain ? <ScrollArea viewportClassName="music-lyrics__scroll"><p className="music-lyrics__plain">{lyrics.plain}</p></ScrollArea>
        : <EmptyState compact icon={<MicVocal />} title={lyrics?.instrumental ? t("musicLyricsInstrumental") : t("musicLyricsNone")} />}
      {source && (lyrics?.synced || lyrics?.plain) ? <div className="music-lyrics__source">{source}</div> : null}
    </section>
  </FloatingPopover>;
}
