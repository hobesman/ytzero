import { describe, expect, test } from "bun:test";
import { isCompactWindow } from "./compactLayout";

describe("isCompactWindow", () => {
  test("phones are compact in either orientation", () => {
    expect(isCompactWindow(412, 915, false)).toBe(true);
    expect(isCompactWindow(915, 412, false)).toBe(true);
  });

  test("tablets keep the full layout", () => {
    expect(isCompactWindow(1280, 800, false)).toBe(false);
  });

  test("televisions never use the compact layout", () => {
    expect(isCompactWindow(960, 540, true)).toBe(false);
  });
});
