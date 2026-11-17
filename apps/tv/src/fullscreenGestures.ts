/**
 * Touch gestures over the phone's fullscreen video, worked out from raw touches so the
 * native player keeps its own controls underneath:
 *
 * - A vertical swipe near the left edge sets the brightness; near the right edge, the volume.
 * - Quick taps on the left or right side jump back or forward: the second tap makes the first
 *   jump, and each tap after it, while they keep coming, makes another.
 *
 * The middle band holds the player's play and skip buttons and the bottom strip its seek bar,
 * so taps there stay plain taps and swipes starting there are left alone.
 */
export const gestureTuning = {
  /** The share of the width, at each side, where a swipe sets brightness or volume. */
  edge: 0.25,
  /** The share of the width, centred, where taps don't seek. */
  centre: 0.3,
  /** The share of the height, at the bottom, left to the seek bar. */
  bottom: 0.15,
  /** Movement, in points, that makes a touch a swipe rather than a tap. */
  slop: 16,
  /** A touch held longer than this isn't a tap. */
  tapMs: 400,
  /** The second tap must come this soon after the first to start seeking... */
  firstGapMs: 300,
  /** ...and each later tap this soon after the one before. */
  nextGapMs: 700,
  jumpSeconds: 10,
  /** A swipe over this share of the height takes a level from 0 to 1. */
  fullSwipe: 0.7,
};

export type LevelTarget = "brightness" | "volume";
export type SeekSide = "back" | "forward";
export type GestureEvent =
  /** A swipe moved: set `target` to `value` (0 to 1). */
  | { kind: "level"; target: LevelTarget; value: number }
  | { kind: "levelEnd"; target: LevelTarget }
  /** One more jump; `jumps` counts them since the taps began. */
  | { kind: "seek"; side: SeekSide; jumps: number }
  /** A tap that isn't seeking: it shows or hides the controls, as before. */
  | { kind: "tap" };

type Touch = { x: number; y: number; time: number; width: number; height: number; mode: LevelTarget | "other" | null; level: number };

export class FullscreenGestures {
  private touch: Touch | null = null;
  private lastTap: { side: SeekSide; time: number; jumps: number } | null = null;

  /** `levels` reads the current brightness and volume; null where they can't be set. */
  constructor(private readonly levels: { brightness(): number; volume(): number } | null) {}

  start(x: number, y: number, time: number, width: number, height: number): void {
    this.touch = { x, y, time, width, height, mode: null, level: 0 };
  }

  move(x: number, y: number): GestureEvent | null {
    const touch = this.touch;
    if (!touch || touch.mode === "other") return null;
    const dx = x - touch.x;
    const dy = y - touch.y;
    if (!touch.mode) {
      if (Math.hypot(dx, dy) < gestureTuning.slop) return null;
      const target: LevelTarget | null = touch.x < touch.width * gestureTuning.edge ? "brightness"
        : touch.x > touch.width * (1 - gestureTuning.edge) ? "volume" : null;
      const vertical = Math.abs(dy) > Math.abs(dx) * 1.5;
      if (!target || !this.levels || !vertical || this.inBottomStrip(touch)) { touch.mode = "other"; return null; }
      touch.mode = target;
      touch.level = target === "brightness" ? this.levels.brightness() : this.levels.volume();
    }
    // Up raises the level.
    const value = clamp(touch.level - dy / (touch.height * gestureTuning.fullSwipe));
    return { kind: "level", target: touch.mode, value };
  }

  end(x: number, y: number, time: number): GestureEvent | null {
    const touch = this.touch;
    this.touch = null;
    if (!touch) return null;
    if (touch.mode === "brightness" || touch.mode === "volume") return { kind: "levelEnd", target: touch.mode };
    if (touch.mode === "other" || time - touch.time >= gestureTuning.tapMs || Math.hypot(x - touch.x, y - touch.y) >= gestureTuning.slop) return null;
    const half = touch.width * gestureTuning.centre / 2;
    const side: SeekSide | null = touch.x < touch.width / 2 - half ? "back" : touch.x > touch.width / 2 + half ? "forward" : null;
    if (!side || this.inBottomStrip(touch)) { this.lastTap = null; return { kind: "tap" }; }
    const last = this.lastTap;
    if (last && last.side === side && time - last.time < (last.jumps ? gestureTuning.nextGapMs : gestureTuning.firstGapMs)) {
      this.lastTap = { side, time, jumps: last.jumps + 1 };
      return { kind: "seek", side, jumps: last.jumps + 1 };
    }
    this.lastTap = { side, time, jumps: 0 };
    return { kind: "tap" };
  }

  /** A touch the system took over (a scroll, the notification shade). */
  cancel(): GestureEvent | null {
    const touch = this.touch;
    this.touch = null;
    return touch?.mode === "brightness" || touch?.mode === "volume" ? { kind: "levelEnd", target: touch.mode } : null;
  }

  private inBottomStrip(touch: Touch): boolean {
    return touch.y > touch.height * (1 - gestureTuning.bottom);
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
