import { describe, expect, test } from "bun:test";
import { playableSpeed, speedLabel, speedMemoryTarget, speedOptions } from "./playbackSpeeds";

describe("playback speeds", () => {
  test("accepts the server's range up to 4×", () => {
    expect(playableSpeed("1.5")).toBe(1.5);
    expect(playableSpeed("3")).toBe(3);
    expect(playableSpeed("4")).toBe(4);
    expect(playableSpeed("4.5")).toBeNull();
    expect(playableSpeed("0")).toBeNull();
    expect(playableSpeed(null)).toBeNull();
    expect(playableSpeed("fast")).toBeNull();
  });

  test("offers speeds above 2× and keeps an unlisted current rate", () => {
    expect(speedOptions(1)).toContain("3");
    expect(speedOptions(1).at(-1)).toBe("4");
    const options = speedOptions(1.3);
    expect(options).toContain("1.3");
    expect(options.indexOf("1.3")).toBe(options.indexOf("1.25") + 1);
  });

  test("labels speeds compactly", () => {
    expect(speedLabel(1)).toBe("1×");
    expect(speedLabel("2.50")).toBe("2.5×");
  });
});

describe("remembered speed changes", () => {
  test("go to the channel's speed when it has one, else the profile default", () => {
    expect(speedMemoryTarget("0", null, false)).toBeNull();
    expect(speedMemoryTarget(undefined, "1.5", false)).toBeNull();
    expect(speedMemoryTarget("1", null, false)).toBe("default");
    expect(speedMemoryTarget("1", "", false)).toBe("default");
    expect(speedMemoryTarget("1", "1.5", false)).toBe("channel");
    expect(speedMemoryTarget("1", null, true)).toBeNull();
  });
});
