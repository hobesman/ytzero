/**
 * The stream quality this device asks the server for, and whether it starts
 * fast. Device-only: never sent to the instance as a setting or included in
 * its backups.
 *
 * "auto" lets the player switch between several renditions as the connection
 * allows; a height caps the stream there. The profile's own download quality
 * setting on the server still caps them. "fast" is not offered in the menu: it
 * is what low-resource mode asks for, the single progressive stream (usually
 * 360p) and nothing heavier.
 */
export const STREAM_QUALITY_KEY = "ytzero.tv.stream-quality";
export const STREAM_QUALITIES = ["fast", "auto", "1080", "720", "480", "360"] as const;
export type StreamQuality = (typeof STREAM_QUALITIES)[number];
/** The choices in the player's quality menu. */
export const QUALITY_MENU_CHOICES = ["auto", "1080", "720", "480", "360"] as const satisfies readonly StreamQuality[];

/**
 * Fast start: a video starts at once in 360p while the chosen quality gets
 * ready, then switches to it; changing quality keeps the video playing until
 * the new one is ready. Off, the video waits for the chosen quality, and a
 * quality change pauses until the new stream plays.
 */
export const FAST_START_KEY = "ytzero.tv.fast-start";

type Store = { getItemAsync(key: string): Promise<string | null>; setItemAsync(key: string, value: string): Promise<void> };

export const parseStreamQuality = (value: unknown): StreamQuality =>
  (STREAM_QUALITIES as readonly unknown[]).includes(value) ? value as StreamQuality : "auto";

let current: StreamQuality = "auto";
let fast = false;

/** The quality new playback asks for. */
export const streamQuality = (): StreamQuality => current;
/** Whether Fast start is on. */
export const fastStart = (): boolean => fast;

/** Loads the quality and Fast start. Fast start used to be the quality "fast": that becomes "auto" with Fast start on. */
export async function loadStreamQuality(store: Store): Promise<StreamQuality> {
  const [storedQuality, storedFast] = await Promise.all([store.getItemAsync(STREAM_QUALITY_KEY), store.getItemAsync(FAST_START_KEY)]);
  current = parseStreamQuality(storedQuality);
  fast = storedFast === "1";
  if (current === "fast") {
    current = "auto";
    fast = true;
    await Promise.all([store.setItemAsync(STREAM_QUALITY_KEY, current), store.setItemAsync(FAST_START_KEY, "1")]);
  }
  return current;
}

export async function saveFastStart(store: Store, value: boolean): Promise<void> {
  fast = value;
  await store.setItemAsync(FAST_START_KEY, value ? "1" : "0");
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
