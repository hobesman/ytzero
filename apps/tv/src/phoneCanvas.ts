import { isCompactWindow } from "./compactLayout";

/**
 * The TV layout is drawn for a large landscape screen. Until phones get layouts
 * of their own, a phone draws it on a virtual canvas this tall and scales it to
 * fit, so every screen keeps its TV proportions at a readable size.
 */
export const phoneCanvasHeight = 720;
/** Narrowest canvas the TV layout fits, for a TV-style sheet shown in portrait. */
export const phoneCanvasWidth = 1280;

export type PhoneCanvas = { scale: number; width: number; height: number };

/** The canvas for the space left inside the system bars, or null when unscaled. */
export function phoneCanvas(width: number, height: number, isTV: boolean): PhoneCanvas | null {
  if (width <= 0 || height <= 0 || !isCompactWindow(width, height, isTV)) return null;
  const scale = Math.min(1, height / phoneCanvasHeight, width / phoneCanvasWidth);
  if (scale >= 1) return null;
  return { scale, width: width / scale, height: height / scale };
}
