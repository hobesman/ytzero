/**
 * The stream quality this device asks the server for. Device-only: never sent
 * to the instance as a setting or included in its backups.
 *
 * "fast" skips the high-quality streams and asks straight away for the single
 * progressive stream (usually 360p), which starts much sooner. "auto" lets the
 * player switch between several renditions as the connection allows; a height
 * caps the stream there. The profile's own download quality setting on the
 * server still caps them.
 */
export const STREAM_QUALITY_KEY = "ytzero.tv.stream-quality";
export const STREAM_QUALITIES = ["fast", "auto", "1080", "720", "480", "360"] as const;
export type StreamQuality = (typeof STREAM_QUALITIES)[number];

type Store = { getItemAsync(key: string): Promise<string | null>; setItemAsync(key: string, value: string): Promise<void> };

export const parseStreamQuality = (value: unknown): StreamQuality =>
  (STREAM_QUALITIES as readonly unknown[]).includes(value) ? value as StreamQuality : "auto";

let current: StreamQuality = "auto";

/** The quality new playback asks for. */
export const streamQuality = (): StreamQuality => current;

export async function loadStreamQuality(store: Store): Promise<StreamQuality> {
  current = parseStreamQuality(await store.getItemAsync(STREAM_QUALITY_KEY));
  return current;
}

export async function saveStreamQuality(store: Store, value: StreamQuality): Promise<void> {
  current = value;
  await store.setItemAsync(STREAM_QUALITY_KEY, value);
}

/** "720p" for a playing track's height; null before a track is known. */
export function heightLabel(height: number | null | undefined): string | null {
  return height && Number.isFinite(height) && height > 0 ? `${Math.round(height)}p` : null;
}

/** The translated names of the choices that are not a height. */
export type StreamQualityLabels = { auto: string; fast: string };

/** A choice's name in the quality menu: "Auto", "Fast start" or "720p". */
export function qualityChoiceLabel(choice: StreamQuality, labels: StreamQualityLabels): string {
  return choice === "auto" || choice === "fast" ? labels[choice] : `${choice}p`;
}

/** The player's quality button: the height playing now, else the choice. */
export function qualityButtonLabel(choice: StreamQuality, playingHeight: number | null | undefined, labels: StreamQualityLabels): string {
  return heightLabel(playingHeight) ?? qualityChoiceLabel(choice, labels);
}
