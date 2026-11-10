import type { BufferOptions } from "expo-video";
import type { Translate } from "./i18n";

/**
 * How far ahead this device buffers the video being watched. Device-only:
 * never sent to the instance as a setting or included in its backups.
 *
 * A longer buffer carries playback through a dropped connection, such as
 * walking out of wifi range or moving between hotspots, for as long as the
 * buffer lasts. Only the playing video gets it: the neighbours prepared for
 * swiping keep the short buffer, so they do not multiply data and memory use.
 */
export const FORWARD_BUFFER_KEY = "ytzero.tv.forward-buffer";
/** Seconds of video buffered ahead. 5 is the standard buffer. */
export const STANDARD_FORWARD_BUFFER = 5;
export const FORWARD_BUFFER_PRESETS = [STANDARD_FORWARD_BUFFER, 30, 60, 120] as const;
/** The range a custom buffer may take, in whole seconds. */
export const MIN_FORWARD_BUFFER = STANDARD_FORWARD_BUFFER;
export const MAX_FORWARD_BUFFER = 600;

/** The short buffer of a prepared neighbour, and of the standard setting. */
export const NEIGHBOUR_BUFFER_OPTIONS: BufferOptions = { preferredForwardBufferDuration: STANDARD_FORWARD_BUFFER, maxBufferBytes: 8 * 1024 * 1024 };
// About 5 Mbit/s, enough for 1080p. The player keeps the buffer in its Java
// heap, so the byte cap stops a high bitrate or a long custom buffer from
// exhausting memory: past it the player buffers less time, not more bytes.
const BYTES_PER_SECOND = 640 * 1024;
export const MAX_FORWARD_BUFFER_BYTES = 96 * 1024 * 1024;

type Store = { getItemAsync(key: string): Promise<string | null>; setItemAsync(key: string, value: string): Promise<void> };

export const isForwardBuffer = (seconds: unknown): seconds is number =>
  typeof seconds === "number" && Number.isInteger(seconds) && seconds >= MIN_FORWARD_BUFFER && seconds <= MAX_FORWARD_BUFFER;

export const parseForwardBuffer = (value: unknown): number => {
  const seconds = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return isForwardBuffer(seconds) ? seconds : STANDARD_FORWARD_BUFFER;
};

let current = STANDARD_FORWARD_BUFFER;
const listeners = new Set<() => void>();

/** Calls back when the setting changes, so a video already playing picks it up. Returns the unsubscribe. */
export function onForwardBufferChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The buffer the playing video uses. */
export const forwardBuffer = (): number => current;

export async function loadForwardBuffer(store: Store): Promise<number> {
  current = parseForwardBuffer(await store.getItemAsync(FORWARD_BUFFER_KEY));
  return current;
}

export async function saveForwardBuffer(store: Store, value: number): Promise<void> {
  if (!isForwardBuffer(value)) throw new RangeError(`forward buffer out of range: ${value}`);
  current = value;
  listeners.forEach((listener) => listener());
  await store.setItemAsync(FORWARD_BUFFER_KEY, String(value));
}

/** The native buffer options for a player: the chosen buffer while it plays, the short one otherwise. */
export function forwardBufferOptions(seconds: number, active: boolean): BufferOptions {
  if (!active || seconds <= STANDARD_FORWARD_BUFFER) return NEIGHBOUR_BUFFER_OPTIONS;
  return {
    preferredForwardBufferDuration: seconds,
    maxBufferBytes: Math.min(MAX_FORWARD_BUFFER_BYTES, Math.max(NEIGHBOUR_BUFFER_OPTIONS.maxBufferBytes ?? 0, seconds * BYTES_PER_SECOND)),
  };
}

const presetLabels = { 5: "bufferStandard", 30: "buffer30Seconds", 60: "buffer1Minute", 120: "buffer2Minutes" } as const;
export const isForwardBufferPreset = (seconds: number): seconds is keyof typeof presetLabels => seconds in presetLabels;

/** A buffer's name in the settings list: a preset's own name, else "90 s". */
export function forwardBufferLabel(seconds: number, t: Translate): string {
  return isForwardBufferPreset(seconds) ? t(presetLabels[seconds]) : t("bufferCustomValue").replace("{count}", String(seconds));
}
