/**
 * The stream quality this device asks the server for. Device-only: never sent
 * to the instance as a setting or included in its backups.
 *
 * "auto" lets the player switch between several renditions as the connection
 * allows; a height caps the stream there. The profile's own download quality
 * setting on the server still caps both.
 */
export const STREAM_QUALITY_KEY = "ytzero.tv.stream-quality";
export const STREAM_QUALITIES = ["auto", "1080", "720", "480", "360"] as const;
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

/**
 * The player's quality button: the height playing now, else the choice.
 * `autoLabel` is the translated word for "auto".
 */
export function qualityButtonLabel(choice: StreamQuality, playingHeight: number | null | undefined, autoLabel: string): string {
  return heightLabel(playingHeight) ?? (choice === "auto" ? autoLabel : `${choice}p`);
}
