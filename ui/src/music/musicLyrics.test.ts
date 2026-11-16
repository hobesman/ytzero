import { expect, test } from "bun:test";
import { currentLyricIndex } from "./musicLyrics";

test("the current lyric is the last line already started", () => {
  const lines = [{ time: 1 }, { time: 4.5 }, { time: 4.5 }, { time: 10 }];
  expect(currentLyricIndex(lines, 0)).toBe(-1);
  expect(currentLyricIndex(lines, 1)).toBe(0);
  expect(currentLyricIndex(lines, 4.4)).toBe(0);
  expect(currentLyricIndex(lines, 5)).toBe(2);
  expect(currentLyricIndex(lines, 600)).toBe(3);
  expect(currentLyricIndex([], 5)).toBe(-1);
});
