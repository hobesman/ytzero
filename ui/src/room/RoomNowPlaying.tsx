import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MicVocal, Music, Pause, Play, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { useI18n } from "../i18n";
import { Alert, Badge, IconButton, ProgressBar, Slider } from "../components/ui";
import { roomApi, type AlexaRoom } from "./roomApi";
import { clockDuration, livePosition, roomArtSource, roomSource, roomVolume, type PendingControl, type RoomDisplay, type RoomSource } from "./roomState";
import { useNow, type RoomCommand } from "./useRoomState";

/** The skills' names as set in YTZERO_ALEXA_*_INVOCATION, written as a name ("hoban music" is Hoban Music). */
export type SkillNames = { music: string | null; video: string | null };

export function skillName(invocation: string | null | undefined): string | null {
  if (!invocation) return null;
  return invocation.replace(/(^|\s)(\p{Ll})/gu, (_, space: string, letter: string) => space + letter.toUpperCase());
}

export function SourceBadge({ source, names }: { source: RoomSource; names: SkillNames }) {
  const { t } = useI18n();
  const label = source.kind === "music" ? names.music ?? t("roomSourceMusic")
    : source.kind === "video" ? names.video ?? t("roomSourceVideo")
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

function RoomProgress({ current, receivedAt }: { current: NonNullable<AlexaRoom["current"]>; receivedAt: number }) {
  const { t } = useI18n();
  const now = useNow(1000, current.state === "playing");
  const position = livePosition(current, receivedAt, now);
  if (!position) return null;
  return <div className="room-now__progress">
    <ProgressBar value={position.positionMs} max={position.durationMs ?? Math.max(position.positionMs, 1)} label={t("roomProgress")} />
    <div className="room-now__times">
      <span>{clockDuration(position.positionMs)}</span>
      <span>{position.durationMs ? clockDuration(position.durationMs) : ""}</span>
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

export function RoomNowPlaying({ roomName, room, display, control, receivedAt, names, onCommand, lyrics, onLyrics }: {
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
}) {
  const { t } = useI18n();
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (!failure) return;
    const timer = window.setTimeout(() => setFailure(null), 8000);
    return () => window.clearTimeout(timer);
  }, [failure]);

  const send = (action: "pause" | "resume" | "next" | "volume", volume?: number) => {
    setFailure(null);
    const body = action === "volume" ? { action, volume: volume ?? 5 } : { action };
    void onCommand(roomName, action, () => roomApi.control(roomName, body), volume).then((error) => {
      if (error) setFailure(t("roomCommandFailed", { room: roomName, error }));
    });
  };

  const item = display.kind === "starting" ? display.item : display.kind === "idle" ? null : display.current;
  const source = display.kind === "starting" ? roomSource(display.item.skill)
    : display.kind === "idle" ? null : roomSource(display.current.origin, display.current.source);
  const playing = display.kind === "playing" || display.kind === "starting";
  const toggleBusy = control?.action === "pause" || control?.action === "resume";
  const { panel, beside } = useCoverBeside([item?.title, item?.artist, display.kind, control?.action === "play", failure].join(""));

  return <section ref={panel} className={`room-now${beside ? " room-now--cover-beside" : ""}`} aria-label={t("roomNowPlaying")} aria-live="polite">
    <div className="room-now__art-box"><RoomArt url={item?.art} /></div>
    <div className="room-now__copy">
      <div className="room-now__badges">
        {source ? <SourceBadge source={source} names={names} /> : null}
        {display.kind === "starting" || control?.action === "play" ? <Badge variant="warning" className="room-now__badge">{t("roomStarting")}</Badge> : null}
        {display.kind === "paused" && control?.action !== "play" ? <Badge className="room-now__badge">{t("roomPaused")}</Badge> : null}
      </div>
      <h1 className="room-now__title">{item?.title || t("roomNothingPlaying")}</h1>
      {item?.artist ? <p className="room-now__artist">{item.artist}</p> : null}
      {display.kind === "playing" || display.kind === "paused" ? <RoomProgress current={display.current} receivedAt={receivedAt} /> : null}
    </div>
    <div className="room-now__controls">
      <IconButton size="xl" variant="primary" busy={toggleBusy}
        label={playing ? t("roomPause") : t("roomResume")} icon={playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        onClick={() => send(playing ? "pause" : "resume")} />
      <IconButton size="xl" variant="secondary" busy={control?.action === "next"} label={t("roomNext")} icon={<SkipForward />} onClick={() => send("next")} />
      <IconButton size="xl" variant={lyrics ? "primary" : "ghost"} aria-pressed={lyrics} label={t("musicLyrics")} icon={<MicVocal />} onClick={() => onLyrics(!lyrics)} />
    </div>
    <RoomVolume room={room} control={control} onVolume={(volume) => send("volume", volume)} />
    {failure ? <Alert variant="danger" role="alert" className="room-now__failure">{failure}</Alert> : null}
  </section>;
}
