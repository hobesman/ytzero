import { describe, expect, test } from "bun:test";
import { FullscreenGestures, gestureTuning } from "./fullscreenGestures";

const width = 2000;
const height = 1000;
const levels = { brightness: () => 0.5, volume: () => 0.2 };

function tap(gestures: FullscreenGestures, x: number, time: number, y = 400) {
  gestures.start(x, y, time, width, height);
  return gestures.end(x, y, time + 50);
}

describe("fullscreen taps", () => {
  test("one tap is a plain tap", () => {
    expect(tap(new FullscreenGestures(levels), 300, 0)).toEqual({ kind: "tap" });
  });

  test("the second quick tap jumps, and each one after it jumps again", () => {
    const gestures = new FullscreenGestures(levels);
    expect(tap(gestures, 300, 0)).toEqual({ kind: "tap" });
    expect(tap(gestures, 310, 200)).toEqual({ kind: "seek", side: "back", jumps: 1 });
    expect(tap(gestures, 300, 700)).toEqual({ kind: "seek", side: "back", jumps: 2 });
    expect(tap(gestures, 300, 1200)).toEqual({ kind: "seek", side: "back", jumps: 3 });
  });

  test("the right side jumps forward", () => {
    const gestures = new FullscreenGestures(levels);
    tap(gestures, 1700, 0);
    expect(tap(gestures, 1700, 200)).toEqual({ kind: "seek", side: "forward", jumps: 1 });
  });

  test("slow taps, or taps on different sides, don't jump", () => {
    const gestures = new FullscreenGestures(levels);
    tap(gestures, 300, 0);
    expect(tap(gestures, 300, gestureTuning.firstGapMs + 100)).toEqual({ kind: "tap" });
    expect(tap(gestures, 1700, gestureTuning.firstGapMs + 200)).toEqual({ kind: "tap" });
  });

  test("a pause ends the run and starts a new one", () => {
    const gestures = new FullscreenGestures(levels);
    tap(gestures, 300, 0);
    tap(gestures, 300, 200);
    expect(tap(gestures, 300, 200 + gestureTuning.nextGapMs + 50)).toEqual({ kind: "tap" });
    expect(tap(gestures, 300, 1100)).toEqual({ kind: "seek", side: "back", jumps: 1 });
  });

  test("the middle band and the seek bar strip never jump", () => {
    const gestures = new FullscreenGestures(levels);
    tap(gestures, 1000, 0);
    expect(tap(gestures, 1000, 200)).toEqual({ kind: "tap" });
    tap(gestures, 300, 1000, 950);
    expect(tap(gestures, 300, 1200, 950)).toEqual({ kind: "tap" });
  });

  test("a long press isn't a tap", () => {
    const gestures = new FullscreenGestures(levels);
    gestures.start(300, 400, 0, width, height);
    expect(gestures.end(300, 400, gestureTuning.tapMs + 10)).toBeNull();
  });
});

describe("fullscreen edge swipes", () => {
  test("swiping up at the left edge raises the brightness", () => {
    const gestures = new FullscreenGestures(levels);
    gestures.start(100, 600, 0, width, height);
    expect(gestures.move(100, 590)).toBeNull();
    expect(gestures.move(102, 460)).toEqual({ kind: "level", target: "brightness", value: 0.7 });
    expect(gestures.end(102, 460, 500)).toEqual({ kind: "levelEnd", target: "brightness" });
  });

  test("swiping down at the right edge lowers the volume, stopping at zero", () => {
    const gestures = new FullscreenGestures(levels);
    gestures.start(1900, 200, 0, width, height);
    expect(gestures.move(1900, 270)).toEqual({ kind: "level", target: "volume", value: expect.closeTo(0.1, 5) });
    expect(gestures.move(1900, 800)).toEqual({ kind: "level", target: "volume", value: 0 });
  });

  test("sideways swipes, the middle, and the seek bar strip are left alone", () => {
    const gestures = new FullscreenGestures(levels);
    gestures.start(100, 500, 0, width, height);
    expect(gestures.move(160, 510)).toBeNull();
    expect(gestures.move(160, 300)).toBeNull();
    gestures.start(1000, 500, 0, width, height);
    expect(gestures.move(1000, 300)).toBeNull();
    gestures.start(100, 950, 0, width, height);
    expect(gestures.move(100, 800)).toBeNull();
  });

  test("without level controls, swipes do nothing", () => {
    const gestures = new FullscreenGestures(null);
    gestures.start(100, 600, 0, width, height);
    expect(gestures.move(100, 400)).toBeNull();
  });

  test("a cancelled swipe still ends", () => {
    const gestures = new FullscreenGestures(levels);
    gestures.start(100, 600, 0, width, height);
    gestures.move(100, 500);
    expect(gestures.cancel()).toEqual({ kind: "levelEnd", target: "brightness" });
  });
});
