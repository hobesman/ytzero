import { describe, expect, test } from "bun:test";
import { levelledVolume } from "./musicLevelling";

describe("music volume levelling", () => {
  test("turns loud songs down by their loudness above the target", () => {
    expect(Math.round(levelledVolume(6, true) * 10_000)).toBe(5012);
    expect(Math.round(levelledVolume(5.71, true) * 10_000)).toBe(5182);
  });

  test("never turns a song up, and leaves it alone when off or unknown", () => {
    expect(levelledVolume(-4, true)).toBe(1);
    expect(levelledVolume(0, true)).toBe(1);
    expect(levelledVolume(6, false)).toBe(1);
    expect(levelledVolume(undefined, true)).toBe(1);
    expect(levelledVolume(null, true)).toBe(1);
    expect(levelledVolume(Number.NaN, true)).toBe(1);
  });
});
