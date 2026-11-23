/**
 * Subtitles for the native player. The server lists each video's tracks as
 * WebVTT addresses (`GET /api/videos/:id/subtitles`); the app reads the chosen
 * one, parses it here, and draws the cue for the player's current time over the
 * video. That works the same for every source: server HLS, a direct stream,
 * the fast-start stopgap or a file on the phone.
 */

export type SubtitleTrack = { lang: string; url: string; label?: string };
export type SubtitleCue = { start: number; end: number; lines: string[] };
/** Parsed cues, sorted by start, with the latest end of each prefix for lookups. */
export type SubtitleCues = { cues: SubtitleCue[]; reach: number[] };

const TIMESTAMP = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", lrm: "", rlm: "" };

function seconds(value: string): number | null {
  const match = TIMESTAMP.exec(value);
  if (!match) return null;
  const [, hours = "0", minutes, secs, fraction] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(secs) + Number((fraction ?? "0").padEnd(3, "0")) / 1000;
}

/** A cue's text without its markup: voice, class and karaoke timing tags, and HTML entities. */
export function cueText(line: string): string {
  return line.replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ").trim();
}

/** Parses WebVTT (and SRT, which differs only in its header and decimal comma). Malformed cues are skipped. */
export function parseSubtitles(text: string): SubtitleCues {
  const cues: SubtitleCue[] = [];
  // Only a truly empty line ends a cue: YouTube's automatic captions hold a line of one space inside a cue.
  for (const block of text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const timing = lines.findIndex((line) => line.includes("-->"));
    if (timing < 0) continue;
    const [from = "", to = ""] = lines[timing]!.split("-->");
    const start = seconds(from);
    const end = seconds(to);
    if (start === null || end === null || !(end > start)) continue;
    const text = lines.slice(timing + 1).map(cueText).filter(Boolean);
    if (text.length) cues.push({ start, end, lines: text });
  }
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  const reach: number[] = [];
  cues.forEach((cue, index) => reach.push(Math.max(cue.end, index ? reach[index - 1]! : 0)));
  return { cues, reach };
}

/**
 * The lines to show at `time`, from every cue covering it, in order. A line
 * repeated by overlapping cues shows once: YouTube's automatic captions repeat
 * the previous line in the next cue to make them roll.
 */
export function activeSubtitleLines({ cues, reach }: SubtitleCues, time: number): string[] {
  if (!(time >= 0)) return [];
  // The last cue starting at or before `time`.
  let low = 0;
  let high = cues.length - 1;
  let last = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (cues[middle]!.start <= time) { last = middle; low = middle + 1; } else high = middle - 1;
  }
  const active: SubtitleCue[] = [];
  for (let index = last; index >= 0 && reach[index]! > time; index -= 1) {
    if (cues[index]!.end > time) active.push(cues[index]!);
  }
  const lines: string[] = [];
  for (const cue of active.reverse()) for (const line of cue.lines) if (!lines.includes(line)) lines.push(line);
  return lines;
}

const base = (language: string) => language.toLowerCase().split(/[-_]/)[0];

/** The track for a language: the same code, or else the same base language ("en" for "en-US"). */
export function matchSubtitleTrack(tracks: readonly SubtitleTrack[], language: string | null | undefined): SubtitleTrack | null {
  if (!language) return null;
  const wanted = language.toLowerCase();
  return tracks.find((track) => track.lang.toLowerCase() === wanted)
    ?? tracks.find((track) => base(track.lang) === base(wanted)) ?? null;
}

/** "off", or the language the viewer last chose in the player on this device; null before any choice. */
export type SubtitleMemory = "off" | string | null;

export type SubtitleDefaults = {
  /** The channel's caption setting: "off" bans captions, "language" forces one. */
  channelMode?: "off" | "language" | null; channelLanguage?: string | null;
  /** The profile's settings: "1" turns captions on by default, in its caption or interface language. */
  playerCc?: string; playerCcLang?: string; playerHl?: string;
  remembered: SubtitleMemory;
};

/**
 * The language a video starts with, or null for off. Like the web player: a
 * channel's own caption setting comes first, then the profile's default. The
 * viewer's last choice in this app replaces the profile's default.
 */
export function defaultSubtitleTrack(tracks: readonly SubtitleTrack[], defaults: SubtitleDefaults): SubtitleTrack | null {
  if (!tracks.length || defaults.channelMode === "off") return null;
  const forced = defaults.channelMode === "language" ? matchSubtitleTrack(tracks, defaults.channelLanguage) : null;
  if (forced) return forced;
  if (defaults.remembered === "off") return null;
  const profile = () => matchSubtitleTrack(tracks, defaults.playerCcLang) ?? matchSubtitleTrack(tracks, defaults.playerHl);
  if (defaults.remembered) return matchSubtitleTrack(tracks, defaults.remembered) ?? profile();
  return defaults.playerCc === "1" ? profile() : null;
}

/** The track list with the profile's languages first, then the rest by label. */
export function orderSubtitleTracks(tracks: readonly SubtitleTrack[], preferred: ReadonlyArray<string | null | undefined>): SubtitleTrack[] {
  const first: SubtitleTrack[] = [];
  for (const language of preferred) {
    const track = matchSubtitleTrack(tracks, language);
    if (track && !first.includes(track)) first.push(track);
  }
  return [...first, ...tracks.filter((track) => !first.includes(track))];
}

/**
 * The viewer's last choice is remembered on the device, shared across profiles,
 * like the stream quality. Never sent to the instance or included in backups.
 */
export const SUBTITLE_CHOICE_KEY = "ytzero.tv.subtitles";
type Store = { getItemAsync(key: string): Promise<string | null>; setItemAsync(key: string, value: string): Promise<void> };
const VALID_CHOICE = /^(off|[A-Za-z0-9][A-Za-z0-9_-]{0,79})$/;

let remembered: SubtitleMemory = null;
let loading: Promise<SubtitleMemory> | null = null;

export const parseSubtitleMemory = (value: unknown): SubtitleMemory =>
  typeof value === "string" && VALID_CHOICE.test(value) ? value : null;

/** Reads the remembered choice once; later calls share the first read. */
export function loadSubtitleMemory(store: Store): Promise<SubtitleMemory> {
  loading ??= store.getItemAsync(SUBTITLE_CHOICE_KEY).then(parseSubtitleMemory, () => null)
    .then((value) => { remembered ??= value; return remembered; });
  return loading.then(() => remembered);
}

/** The remembered choice, once loaded. */
export const subtitleMemory = (): SubtitleMemory => remembered;

export async function saveSubtitleMemory(store: Store, value: "off" | string): Promise<void> {
  remembered = value;
  await store.setItemAsync(SUBTITLE_CHOICE_KEY, value);
}

/** For tests: forgets what was read. */
export function resetSubtitleMemory(): void { remembered = null; loading = null; }

/**
 * The profile's caption look, as the web player reads it: a size in pixels
 * around 19 (older profiles say "small", "medium" or "large"), a colour, and
 * the backdrop's opacity. `scale` is the size against the default.
 */
export function subtitleAppearance(settings: { player_sub_size?: string; player_sub_color?: string; player_sub_bg?: string } | null | undefined) {
  const raw = settings?.player_sub_size;
  const size = raw === "small" ? 14 : raw === "large" ? 26 : raw === "medium" ? 19 : Math.min(48, Math.max(12, Number(raw) || 19));
  const color = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(settings?.player_sub_color ?? "") ? settings!.player_sub_color! : "#ffffff";
  const opacity = Number(settings?.player_sub_bg ?? 75);
  return { scale: size / 19, color, background: `rgba(0, 0, 0, ${Math.min(100, Math.max(0, Number.isFinite(opacity) ? opacity : 75)) / 100})` };
}
