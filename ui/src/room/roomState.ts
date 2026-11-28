import type { AlexaRoom, AlexaRooms, RoomCurrent, RoomPendingPlay } from "./roomApi";
import { img } from "../img";

/**
 * The room page's state logic, kept free of React so it can be tested: live
 * progress, which source to name, whether a button's command has taken
 * effect yet, and how often to ask the server.
 */

export function findRoom(rooms: AlexaRooms | null, name: string): AlexaRoom | null {
  const key = name.trim().toLowerCase();
  return rooms?.rooms.find((room) => room.room.toLowerCase() === key) ?? null;
}

/**
 * Where playback is now. The server worked `positionMs` out when it answered;
 * while playing, the time since this page received that answer is added. The
 * page's own clock measures that interval, so a tablet whose clock is off
 * still draws the bar right.
 */
export function livePosition(current: RoomCurrent | null, receivedAt: number, now: number): { positionMs: number; durationMs: number | null } | null {
  if (!current || current.positionMs == null) return null;
  const elapsed = current.state === "playing" ? Math.max(0, now - receivedAt) : 0;
  const durationMs = current.durationMs && current.durationMs > 0 ? current.durationMs : null;
  const positionMs = Math.max(0, current.positionMs + elapsed);
  return { positionMs: durationMs ? Math.min(positionMs, durationMs) : positionMs, durationMs };
}

/** "3:07", or "1:02:45" past an hour. */
export function clockDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** The badge naming where the sound comes from. Home Assistant names only the Echo's input, if that. */
export type RoomSource = { kind: "music" } | { kind: "video" } | { kind: "home-assistant"; source: string | null };

export function roomSource(origin: RoomCurrent["origin"] | RoomPendingPlay["skill"], source: string | null = null): RoomSource {
  if (origin === "music" || origin === "video") return { kind: origin };
  // "Local Speaker" is the Echo's own input (Amazon Music, radio, podcasts): it names nothing a person would recognise.
  return { kind: "home-assistant", source: source && source.trim().toLowerCase() !== "local speaker" ? source : null };
}

/** What the now-playing panel shows. */
export type RoomDisplay =
  | { kind: "starting"; item: RoomPendingPlay }
  | { kind: "playing" | "paused"; current: RoomCurrent }
  | { kind: "idle"; last: RoomCurrent | null };

export function roomDisplay(room: AlexaRoom | null): RoomDisplay {
  if (room?.pending) return { kind: "starting", item: room.pending };
  const current = room?.current ?? null;
  if (current?.state === "playing") return { kind: "playing", current };
  if (current?.state === "paused") return { kind: "paused", current };
  return { kind: "idle", last: current?.title ? current : null };
}

/** When the room last changed, for "Last played": our skills' record, else Home Assistant's. */
export function lastPlayedAt(room: AlexaRoom | null): string | null {
  return room?.nowPlaying?.updatedAt ?? room?.homeAssistant?.changedAt ?? null;
}

/** The Echo's volume on the page's 0–10 scale, when Home Assistant reports it. */
export function roomVolume(room: AlexaRoom | null): number | null {
  const level = room?.homeAssistant?.volume;
  return typeof level === "number" && Number.isFinite(level) ? Math.round(Math.min(1, Math.max(0, level)) * 10) : null;
}

/** A command sent from the page, shown as pending until the room's state reflects it. */
export type PendingControl = {
  action: "pause" | "resume" | "next" | "volume" | "play";
  sentAt: number;
  /** For volume: the level asked for, 0–10. */
  volume?: number;
  /** The room as it was when the button was pressed. */
  before: RoomFingerprint;
};

export type RoomFingerprint = { item: string | null; state: string | null; pendingAt: string | null };

export function roomFingerprint(room: AlexaRoom | null): RoomFingerprint {
  const current = room?.current ?? null;
  return {
    item: current ? [current.origin, current.title ?? "", current.artist ?? ""].join("\n") : null,
    state: current?.state ?? null,
    pendingAt: room?.pending?.requestedAt ?? null,
  };
}

/** Commands to our skills are typed to the Echo and take a few seconds; give up waiting after this. */
export const CONTROL_TIMEOUT_MS = 20_000;

/** Whether the room now shows the command's effect. */
export function controlConfirmed(control: PendingControl, room: AlexaRoom | null): boolean {
  const now = roomFingerprint(room);
  const startedSomething = now.pendingAt !== null && now.pendingAt !== control.before.pendingAt;
  const changedItem = now.item !== control.before.item;
  switch (control.action) {
    case "pause": return now.state !== "playing";
    case "resume": return now.state === "playing" && !room?.pending;
    case "next": return startedSomething || (changedItem && now.state === "playing");
    case "play": return startedSomething || (changedItem && now.state === "playing");
    case "volume": {
      const level = roomVolume(room);
      // Nothing reports the volume back without Home Assistant: the answer is all there is.
      return level === null || level === control.volume;
    }
  }
}

/** The command still waiting: null once confirmed or given up on. */
export function settleControl(control: PendingControl | null, room: AlexaRoom | null, now: number): PendingControl | null {
  if (!control) return null;
  if (now - control.sentAt > CONTROL_TIMEOUT_MS) return null;
  return controlConfirmed(control, room) ? null : control;
}

/** The page dims to its idle screen after this long untouched with nothing playing. */
export const IDLE_AFTER_MS = 60_000;

export function isIdle(display: RoomDisplay, lastTouchAt: number, now: number, waiting: boolean): boolean {
  if (waiting || display.kind === "starting" || display.kind === "playing") return false;
  return now - lastTouchAt >= IDLE_AFTER_MS;
}

/**
 * How long until the next poll of the rooms list: quickly while a command is
 * waiting to show, every few seconds while someone may be watching, slowly
 * on the idle screen, and not at all while the page is hidden.
 */
export function pollDelay({ visible, idle, waiting }: { visible: boolean; idle: boolean; waiting: boolean }): number | null {
  if (!visible) return null;
  if (waiting) return 1_000;
  return idle ? 15_000 : 2_500;
}

/** The tablet's own time zone: the kitchen's clock, whatever the server's clock is in. */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** The room this tablet shows when none is in the address. */
export const ROOM_STORAGE_KEY = "ytzero_room_page_room";
/** Whether this tablet shows lyrics in place of the browser. */
export const ROOM_LYRICS_KEY = "ytzero_room_page_lyrics";

export function storedRoom(storage: Pick<Storage, "getItem"> | null): string | null {
  try {
    return storage?.getItem(ROOM_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

/** The path for a room: `/room/Living%20Room`, with an optional tab. */
export function roomPath(name: string, tab?: string): string {
  return `/room/${encodeURIComponent(name)}${tab ? `/${tab}` : ""}`;
}

const PROXIED_ART_HOSTS = ["ytimg.com", "ggpht.com", "googleusercontent.com", "youtube.com"];

/**
 * Where to load a now-playing picture from. YT Zero's image proxy only
 * fetches YouTube's hosts, so other services' art (Amazon Music's, from Home
 * Assistant) loads straight from its own https address.
 */
export function roomArtSource(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try { parsed = new URL(url, "http://local.invalid"); } catch { return null; }
  if (parsed.origin === "http://local.invalid") return url;
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  return PROXIED_ART_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)) ? img(url) : url;
}

/** Which song to show lyrics for: a Hoban Music track by its video, or a song by name (Amazon Music through Home Assistant). */
export type RoomLyricsSong =
  | { kind: "track"; videoId: string; key: string }
  | { kind: "song"; artist: string; title: string; duration: number | null; key: string }
  /** A Hoban Tube video: its subtitles stand in for lyrics. */
  | { kind: "video"; videoId: string; key: string }
  | null;

export function roomLyricsSong(room: AlexaRoom | null): RoomLyricsSong {
  const current = room?.current;
  if (!current?.title || current.state === "finished") return null;
  const videoId = current.origin === "home-assistant" ? null : room?.nowPlaying?.videoId;
  if (current.origin === "video") return videoId ? { kind: "video", videoId, key: `video:${videoId}` } : null;
  if (videoId) return { kind: "track", videoId, key: `track:${videoId}` };
  if (!current.artist) return null;
  const duration = current.durationMs ? Math.round(current.durationMs / 1000) : null;
  return { kind: "song", artist: current.artist, title: current.title, duration, key: `song:${current.artist}|${current.title}` };
}
