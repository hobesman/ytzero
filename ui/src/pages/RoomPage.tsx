import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, Home, Music, Settings2, Tv } from "lucide-react";
import { useI18n } from "../i18n";
import { Alert, Badge, Button, EmptyState, IconButton, SelectMenu, Tabs } from "../components/ui";
import { roomApi } from "../room/roomApi";
import { RoomIdle } from "../room/RoomIdle";
import { RoomLyrics } from "../room/RoomLyrics";
import { RoomBooksTab } from "../room/RoomBooksTab";
import { RoomMusicTab } from "../room/RoomMusicTab";
import { RoomNowPlaying, skillName, type SkillNames } from "../room/RoomNowPlaying";
import { RoomSetup } from "../room/RoomSetup";
import { RoomVideoTab } from "../room/RoomVideoTab";
import { useOpenPlaying } from "../room/useOpenPlaying";
import {
  ROOM_LYRICS_KEY, ROOM_STORAGE_KEY, deviceTimeZone, findRoom, isIdle, lastPlayedAt, roomDisplay, roomPath, storedRoom,
} from "../room/roomState";
import { useLongPress, useNow, useRooms, useScreenWakeLock, useSessionRenewal } from "../room/useRoomState";
import "./RoomPage.css";

type RoomTab = "music" | "videos" | "books";
const TABS: readonly RoomTab[] = ["music", "videos", "books"];

function safeStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function useSkillNames(): SkillNames {
  const [names, setNames] = useState<SkillNames>({ music: null, video: null, books: null });
  useEffect(() => {
    roomApi.homeAssistant().then((answer) => {
      const invocations = (answer as { invocations?: { music?: string | null; video?: string | null; books?: string | null } }).invocations;
      setNames({ music: skillName(invocations?.music), video: skillName(invocations?.video), books: skillName(invocations?.books) });
    }, () => {});
  }, []);
  return names;
}

/**
 * A full-screen page for a wall tablet beside an Echo: the room's now
 * playing with its controls, music, Hoban Tube and books to start there, and a
 * switcher for the other rooms. Address: /room/<room>/<tab>.
 */
export default function RoomPage() {
  const { t, locale } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const parts = location.pathname.split("/").filter(Boolean).slice(1).map((part) => decodeURIComponent(part));
  const homeRoom = parts[0]?.trim() || null;
  const tab: RoomTab = TABS.includes(parts[1] as RoomTab) ? parts[1] as RoomTab : "music";
  const [viewing, setViewing] = useState<string | null>(null);
  const roomName = viewing ?? homeRoom ?? "";
  const [setupOpen, setSetupOpen] = useState(false);
  // Lyrics mode is the tablet's own choice, so it survives a reload or a night on the idle screen.
  const [lyrics, setLyricsState] = useState(() => { try { return safeStorage()?.getItem(ROOM_LYRICS_KEY) === "1"; } catch { return false; } });
  const setLyrics = (on: boolean) => {
    setLyricsState(on);
    try { safeStorage()?.setItem(ROOM_LYRICS_KEY, on ? "1" : "0"); } catch { /* storage blocked: it lasts until the page reloads */ }
  };
  const [lastTouch, setLastTouch] = useState(() => Date.now());
  const lastTouchRef = useRef(lastTouch);
  const now = useNow(5_000);
  const [idleState, setIdleState] = useState(false);
  const { snapshot, offline, forbidden, controls, command, reload } = useRooms(idleState);
  const names = useSkillNames();
  useScreenWakeLock();
  useSessionRenewal();

  const room = findRoom(snapshot?.rooms ?? null, roomName);
  const display = roomDisplay(room);
  const control = controls[roomName.toLowerCase()] ?? null;
  const openPlaying = useOpenPlaying(homeRoom, display.kind === "playing" || display.kind === "paused" ? display.current : null, () => setLyrics(false));
  const idle = Boolean(homeRoom) && !setupOpen && isIdle(display, lastTouch, now, Boolean(control));
  useEffect(() => setIdleState(idle), [idle]);
  // Another room is only visited: after a while untouched, the tablet goes back to its own.
  useEffect(() => { if (idle && viewing) setViewing(null); }, [idle, viewing]);
  useEffect(() => {
    if (homeRoom) try { safeStorage()?.setItem(ROOM_STORAGE_KEY, homeRoom); } catch { /* storage blocked: the address still names the room */ }
  }, [homeRoom]);
  useEffect(() => { document.title = roomName || t("roomSetupTitle"); }, [roomName, t]);

  const touch = useCallback(() => {
    const at = Date.now();
    // Pointer events come thick and fast while scrolling; a second's precision is plenty.
    if (at - lastTouchRef.current < 1000) return;
    lastTouchRef.current = at;
    setLastTouch(at);
  }, []);
  const setupPress = useLongPress(() => setSetupOpen(true));
  const clock = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: deviceTimeZone() }).format(now);

  const roomOptions = useMemo(() => (snapshot?.rooms.rooms ?? []).map((item) => ({
    value: item.room,
    label: item.current?.state === "playing" || item.pending ? `${item.room} · ${t("roomPlayingShort")}` : item.room,
  })), [snapshot, t]);

  if (!homeRoom) {
    const stored = storedRoom(safeStorage());
    if (stored) return <Navigate to={roomPath(stored)} replace />;
  }
  const chooseRoom = (next: string) => {
    setSetupOpen(false);
    setViewing(null);
    navigate(roomPath(next, tab === "music" ? undefined : tab));
  };
  const setup = <RoomSetup open={setupOpen || !homeRoom} onOpenChange={(open) => { if (homeRoom) setSetupOpen(open); }}
    homeRoom={homeRoom} rooms={snapshot?.rooms ?? null} onChooseRoom={chooseRoom} onChanged={() => void reload()} />;

  if (!homeRoom) return <div className="room-page room-page--setup">{setup}</div>;
  if (forbidden) return <div className="room-page"><EmptyState icon={<Home />} title={t("roomNotAllowed")} /></div>;

  return <div className={`room-page${idle ? " room-page--idle" : ""}`} onPointerDown={touch} onKeyDown={touch}>
    {idle ? <RoomIdle roomName={roomName} last={display.kind === "idle" ? display.last : null} lastAt={lastPlayedAt(room)} /> : <>
      <header className="room-page__bar">
        <button type="button" className="room-page__room" {...setupPress} aria-label={t("roomSetupOpen", { room: roomName })}>
          <Home aria-hidden="true" />
          <span>{roomName}</span>
        </button>
        {viewing ? <Button size="lg" variant="ghost" onClick={() => setViewing(null)}>{t("roomBackTo", { room: homeRoom })}</Button> : null}
        <div className="room-page__spacer" />
        {offline ? <Badge variant="danger">{t("roomOffline")}</Badge> : null}
        {roomOptions.length > 1 ? <SelectMenu size="lg" label={t("roomSwitcher")} value={room?.room ?? roomName} options={roomOptions} floating
          onChange={(next) => setViewing(next.toLowerCase() === homeRoom.toLowerCase() ? null : next)} /> : null}
        <span className="room-page__clock">{clock}</span>
        <IconButton size="lg" variant="ghost" label={t("roomSetupTitle")} icon={<Settings2 />} className="room-page__setup" onClick={() => setSetupOpen(true)} />
      </header>
      <div className="room-page__body">
        {!snapshot ? <div className="room-now room-now--loading" /> : !room
          ? <section className="room-now"><EmptyState icon={<Home />} title={t("roomUnknown", { room: roomName })} description={t("roomUnknownHint")}
            action={<Button size="lg" onClick={() => setSetupOpen(true)}>{t("roomSetupTitle")}</Button>} /></section>
          : <RoomNowPlaying roomName={room.room} room={room} display={display} control={control} receivedAt={snapshot.receivedAt} names={names} onCommand={command} lyrics={lyrics} onLyrics={setLyrics} onOpenArt={openPlaying.action} />}
        {lyrics ? <section className="room-page__browse room-page__browse--lyrics"><RoomLyrics room={room} receivedAt={snapshot?.receivedAt ?? 0} /></section> : <section className="room-page__browse">
          <Tabs label={t("roomTabs")} value={tab} onChange={(next) => navigate(roomPath(homeRoom, next === "music" ? undefined : next))} options={[
            { value: "music", label: names.music ?? t("roomSourceMusic"), icon: <Music /> },
            { value: "videos", label: names.video ?? t("roomSourceVideo"), icon: <Tv /> },
            { value: "books", label: names.books ?? t("roomTabBooks"), icon: <BookOpen /> },
          ]} className="room-page__tabs" />
          <div className="room-page__panel">
            {openPlaying.notice ? <Alert variant="warning" role="status" className="room-tab__failure">{openPlaying.notice}</Alert> : null}
            {tab === "music" ? <RoomMusicTab roomName={room?.room ?? roomName} homeRoom={homeRoom} path={parts.slice(2)} onCommand={command}
              playingKey={room?.current ? `${room.current.title ?? ""}|${room.current.artist ?? ""}` : ""} />
              : tab === "videos" ? <RoomVideoTab roomName={room?.room ?? roomName} onCommand={command} />
              : <RoomBooksTab roomName={room?.room ?? roomName} homeRoom={homeRoom} path={parts.slice(2)} onCommand={command} current={room?.current ?? null} />}
          </div>
        </section>}
      </div>
    </>}
    {setup}
  </div>;
}

