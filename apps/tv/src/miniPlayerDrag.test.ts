import { describe, expect, test } from "bun:test";
import { clampOffset } from "./miniPlayerDrag";

describe("mini player drag bounds", () => {
  const bounds = { maxLeft: 200, maxUp: 500 };

  test("keeps a position inside the screen as it is", () => {
    expect(clampOffset({ x: -120, y: -300 }, bounds)).toEqual({ x: -120, y: -300 });
  });

  test("stops at the edges in every direction", () => {
    expect(clampOffset({ x: -900, y: -900 }, bounds)).toEqual({ x: -200, y: -500 });
    expect(clampOffset({ x: 50, y: 80 }, bounds)).toEqual({ x: 0, y: 0 });
  });

  test("pins to the home corner when there is no room to move", () => {
    expect(clampOffset({ x: -40, y: -40 }, { maxLeft: -10, maxUp: -5 })).toEqual({ x: 0, y: 0 });
  });
});
