import { describe, expect, test } from "bun:test";
import { landscapeColumns, landscapePlayerWidth } from "./landscapeLayout";

describe("landscape layout sizes", () => {
  test("fits as many video columns as the width allows, at least one", () => {
    expect(landscapeColumns(0)).toBe(1);
    expect(landscapeColumns(280)).toBe(1);
    expect(landscapeColumns(640)).toBe(2);
    // A 1024-wide car screen, less the side rail.
    expect(landscapeColumns(1024 - 92)).toBe(3);
  });

  test("gives music's player about two fifths of the screen, within limits", () => {
    expect(landscapePlayerWidth(600)).toBe(300);
    expect(landscapePlayerWidth(932)).toBe(373);
    expect(landscapePlayerWidth(2000)).toBe(480);
  });
});
