import type { Video } from "./types";

/** The Shorts the phone's vertical player swipes through, and how to fetch more. */
export type ShortsSession = { items: Video[]; index: number; loadMore?: () => Promise<Video[]> };
export type OpenShorts = (items: Video[], index: number, loadMore?: () => Promise<Video[]>) => void;

export const isShort = (video: Video) => video.is_short === 1;

/** The Shorts on a screen, starting at the one tapped; other videos are skipped. */
export function shortsFrom(list: Video[], video: Video): { items: Video[]; index: number } {
  const items = list.filter(isShort);
  const index = items.findIndex((item) => item.video_id === video.video_id);
  return index < 0 ? { items: [video], index: 0 } : { items, index };
}

/** Appends newly loaded Shorts, skipping ones already in the list. */
export function appendShorts(items: Video[], more: Video[]): Video[] {
  const seen = new Set(items.map((item) => item.video_id));
  const added = more.filter((item) => isShort(item) && !seen.has(item.video_id) && (seen.add(item.video_id), true));
  return added.length ? [...items, ...added] : items;
}

/** The Shorts kept loaded: the one on screen and the ones a swipe away. */
export function loadedShorts(items: Video[], index: number): Video[] {
  return [index, index + 1, index - 1].map((position) => items[position]).filter((item): item is Video => Boolean(item));
}

/** More Shorts are fetched when the viewer is this close to the end. */
export function wantsMoreShorts(length: number, index: number, ahead = 3): boolean {
  return length - 1 - index < ahead;
}

/** The page a vertical pager has settled on. */
export function pageAt(offset: number, pageHeight: number, length: number): number {
  if (pageHeight <= 0 || length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, Math.round(offset / pageHeight)));
}
