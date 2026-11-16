import { useSyncExternalStore } from "react";
import type { StreamQuality } from "./streamQuality";

/**
 * Low-resource mode, for slow hardware on a slow connection (a car head unit
 * with 2 GB of RAM and Wi-Fi of about 250 KB/s). Device-only: never sent to
 * the instance or included in its backups.
 *
 * While it is on, video asks for the single 360p progressive stream unless a
 * lower height was chosen, thumbnails load at YouTube's 320×180 size instead
 * of 480×360 or larger, animations and the blurred backdrop are off, and long
 * lists keep fewer cards mounted off screen.
 */
export const LOW_RESOURCE_KEY = "ytzero.phone.low-resource";

type Store = { getItemAsync(key: string): Promise<string | null>; setItemAsync(key: string, value: string): Promise<void> };

let current = false;
const listeners = new Set<() => void>();

function set(value: boolean) {
  if (value === current) return;
  current = value;
  for (const listener of listeners) listener();
}

/** Whether low-resource mode is on now. */
export const lowResource = (): boolean => current;

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Low-resource mode, re-rendering when it changes. */
export const useLowResource = (): boolean => useSyncExternalStore(subscribe, lowResource, lowResource);

export async function loadLowResource(store: Store): Promise<boolean> {
  set((await store.getItemAsync(LOW_RESOURCE_KEY)) === "1");
  return current;
}

export async function saveLowResource(store: Store, value: boolean): Promise<void> {
  await store.setItemAsync(LOW_RESOURCE_KEY, value ? "1" : "0");
  set(value);
}

/** How much of a long phone list stays mounted: a screen either side, or less in low-resource mode. */
export function phoneListWindow(low: boolean) {
  return low
    ? { initialNumToRender: 3, maxToRenderPerBatch: 2, windowSize: 3 }
    : { initialNumToRender: 4, maxToRenderPerBatch: 4, windowSize: 7 };
}

export const usePhoneListWindow = () => phoneListWindow(useLowResource());

/** The quality playback asks for: in low-resource mode, nothing above 360p. */
export function cappedStreamQuality(choice: StreamQuality, low: boolean): StreamQuality {
  return low && (choice === "auto" || choice === "1080" || choice === "720" || choice === "480") ? "fast" : choice;
}

const youTubeThumbnail = /\/(?:hqdefault|sddefault|maxresdefault|hq720)\.(jpg|webp)$/;

/** A YouTube thumbnail URL at its 320×180 size; any other URL unchanged. */
export function smallThumbnailUrl(url: string): string {
  try {
    const image = new URL(url);
    if (image.hostname !== "i.ytimg.com" && !image.hostname.endsWith(".ytimg.com")) return url;
    if (!youTubeThumbnail.test(image.pathname)) return url;
    image.pathname = image.pathname.replace(youTubeThumbnail, "/mqdefault.$1");
    image.search = "";
    return image.toString();
  } catch {
    return url;
  }
}
