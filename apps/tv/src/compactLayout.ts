/**
 * Phones and other small touch screens get a compact layout. Televisions keep
 * the ten-foot layout at any size, because their window is measured in
 * density-independent pixels that can be small on a 4K panel.
 *
 * The limit is the 720 points the TV layout is drawn for: a 1024×600 car head
 * unit or a 7-inch tablet is too short for it, and at exactly 600 its ten-foot
 * sign-in screens were cramped past use.
 */
export const compactShortSideLimit = 720;

export function isCompactWindow(width: number, height: number, isTV: boolean): boolean {
  return !isTV && Math.min(width, height) < compactShortSideLimit;
}
