/** How far the mini player may move from its home corner (bottom right): left and up only. */
export type DragBounds = { maxLeft: number; maxUp: number };
export type DragOffset = { x: number; y: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Keeps a dragged mini player on screen; with no room to move it stays in its home corner. */
export const clampOffset = (offset: DragOffset, bounds: DragBounds): DragOffset => ({
  x: clamp(offset.x, Math.min(0, -bounds.maxLeft), 0),
  y: clamp(offset.y, Math.min(0, -bounds.maxUp), 0),
});
