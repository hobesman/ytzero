import type { BufferOptions } from "expo-video";

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
export const FORWARD_BUFFERS = [5, 30, 60, 120] as const;
export type ForwardBuffer = (typeof FORWARD_BUFFERS)[number];
export const STANDARD_FORWARD_BUFFER: ForwardBuffer = 5;

/** The short buffer of a prepared neighbour, and of the standard setting. */
export const NEIGHBOUR_BUFFER_OPTIONS: BufferOptions = { preferredForwardBufferDuration: STANDARD_FORWARD_BUFFER, maxBufferBytes: 8 * 1024 * 1024 };
// About 5 Mbit/s, enough for 1080p. The player keeps the buffer in its Java
// heap, so the byte cap stops a high bitrate from exhausting memory; it then
// buffers less time rather than more bytes.
const BYTES_PER_SECOND = 640 * 1024;

type Store = { getItemAsync(key: string): Promise<string | null>; setItemAsync(key: string, value: string): Promise<void> };

export const parseForwardBuffer = (value: unknown): ForwardBuffer => {
  const seconds = typeof value === "string" ? Number(value) : value;
  return (FORWARD_BUFFERS as readonly unknown[]).includes(seconds) ? seconds as ForwardBuffer : STANDARD_FORWARD_BUFFER;
};

let current: ForwardBuffer = STANDARD_FORWARD_BUFFER;
const listeners = new Set<() => void>();

/** Calls back when the setting changes, so a video already playing picks it up. Returns the unsubscribe. */
export function onForwardBufferChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The buffer the playing video uses. */
export const forwardBuffer = (): ForwardBuffer => current;

export async function loadForwardBuffer(store: Store): Promise<ForwardBuffer> {
  current = parseForwardBuffer(await store.getItemAsync(FORWARD_BUFFER_KEY));
  return current;
}

export async function saveForwardBuffer(store: Store, value: ForwardBuffer): Promise<void> {
  current = value;
  listeners.forEach((listener) => listener());
  await store.setItemAsync(FORWARD_BUFFER_KEY, String(value));
}

/** The native buffer options for a player: the chosen buffer while it plays, the short one otherwise. */
export function forwardBufferOptions(seconds: ForwardBuffer, active: boolean): BufferOptions {
  if (!active || seconds <= STANDARD_FORWARD_BUFFER) return NEIGHBOUR_BUFFER_OPTIONS;
  return { preferredForwardBufferDuration: seconds, maxBufferBytes: Math.max(NEIGHBOUR_BUFFER_OPTIONS.maxBufferBytes ?? 0, seconds * BYTES_PER_SECOND) };
}

/** The message key naming a choice in the settings list. */
export const forwardBufferLabelKey = (seconds: ForwardBuffer) =>
  ({ 5: "bufferStandard", 30: "buffer30Seconds", 60: "buffer1Minute", 120: "buffer2Minutes" } as const)[seconds];
