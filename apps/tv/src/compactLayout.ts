/**
 * Phones and other small touch screens get a compact layout. Televisions keep
 * the ten-foot layout at any size, because their window is measured in
 * density-independent pixels that can be small on a 4K panel.
 */
export const compactShortSideLimit = 600;

export function isCompactWindow(width: number, height: number, isTV: boolean): boolean {
  return !isTV && Math.min(width, height) < compactShortSideLimit;
}
