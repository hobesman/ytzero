import { describe, expect, test } from "bun:test";
import { phoneCanvas } from "./phoneCanvas";

describe("phoneCanvas", () => {
  test("scales a landscape phone to a 720-tall canvas", () => {
    const canvas = phoneCanvas(860, 390, false)!;
    expect(canvas.height).toBeCloseTo(720);
    expect(canvas.scale).toBeCloseTo(390 / 720);
    expect(canvas.width).toBeCloseTo(860 * 720 / 390);
  });

  test("leaves televisions and large windows alone", () => {
    expect(phoneCanvas(960, 540, true)).toBeNull();
    expect(phoneCanvas(1280, 800, false)).toBeNull();
  });

  test("ignores an empty window before layout", () => {
    expect(phoneCanvas(0, 0, false)).toBeNull();
  });
});
