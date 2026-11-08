import { describe, expect, test } from "bun:test";
import { parseShareTimestamp, withShareTimestamp } from "./shareTimestamp";

describe("share timestamps", () => {
  test("adds the start time to a public share link", () => {
    expect(withShareTimestamp("https://tube.example/share/abc", 95)).toBe("https://tube.example/share/abc?t=95");
    expect(withShareTimestamp("https://tube.example/share/abc", 12.8)).toBe("https://tube.example/share/abc?t=12");
  });

  test("leaves the link alone without a start time", () => {
    expect(withShareTimestamp("https://tube.example/share/abc", 0)).toBe("https://tube.example/share/abc");
    expect(withShareTimestamp("https://tube.example/share/abc", undefined)).toBe("https://tube.example/share/abc");
    expect(withShareTimestamp("https://tube.example/share/abc", Number.NaN)).toBe("https://tube.example/share/abc");
  });

  test("replaces an existing start time", () => {
    expect(withShareTimestamp("https://tube.example/share/abc?t=5", 40)).toBe("https://tube.example/share/abc?t=40");
  });

  test("reads the start time from a query string", () => {
    expect(parseShareTimestamp("?t=95")).toBe(95);
    expect(parseShareTimestamp("?t=12.8")).toBe(12);
    expect(parseShareTimestamp("")).toBe(0);
    expect(parseShareTimestamp("?t=abc")).toBe(0);
    expect(parseShareTimestamp("?t=-4")).toBe(0);
  });
});
