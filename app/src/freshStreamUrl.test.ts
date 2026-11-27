import { describe, expect, test } from "bun:test";
import { freshUrlDeadline, parseAvailableAt, retryWhileFresh } from "./freshStreamUrl";

describe("fresh stream addresses", () => {
  test("reads yt-dlp's available_at in seconds, and nothing else", () => {
    expect(parseAvailableAt(1_795_379_733)).toBe(1_795_379_733_000);
    expect(parseAvailableAt("1795379733")).toBe(1_795_379_733_000);
    expect(parseAvailableAt("NA")).toBeNull();
    expect(parseAvailableAt(null)).toBeNull();
    expect(parseAvailableAt(-5)).toBeNull();
  });

  test("waits a little past available_at, at least a few seconds and never very long", () => {
    const issued = 1_000_000;
    expect(freshUrlDeadline(issued, issued + 29_000)).toBe(issued + 34_000);
    // Ready almost at once: still a few seconds' allowance.
    expect(freshUrlDeadline(issued, issued + 1_000)).toBe(issued + 8_000);
    expect(freshUrlDeadline(issued, null)).toBe(issued + 8_000);
    // A wildly late available_at is capped.
    expect(freshUrlDeadline(issued, issued + 10 * 60_000)).toBe(issued + 45_000);
  });

  test("returns as soon as the address is served, without waiting out the deadline", async () => {
    let calls = 0;
    const { result, waitedMs } = await retryWhileFresh(
      async () => ++calls >= 3 ? "ok" : "refused",
      (value) => value === "refused",
      Date.now() + 60_000,
      { pollMs: 1 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(waitedMs).toBeLessThan(1_000);
  });

  test("does not retry an address that was served the first time", async () => {
    let calls = 0;
    // A clock of its own: on a slow runner the real one can tick during the one call.
    const { result, waitedMs } = await retryWhileFresh(async () => { calls++; return "ok"; }, () => false, 1_000_000 + 60_000, { pollMs: 1, now: () => 1_000_000 });
    expect([result, calls, waitedMs]).toEqual(["ok", 1, 0]);
  });

  test("gives up at the deadline, and stays bounded when the clock stands still", async () => {
    let calls = 0;
    const { result } = await retryWhileFresh(async () => { calls++; return "refused"; }, () => true, 1_000_000 + 8_000, { pollMs: 1, now: () => 1_000_000 });
    expect(result).toBe("refused");
    // 8 s at the real 2 s interval: four retries after the first try.
    expect(calls).toBe(5);
  });

  test("stops when the request is cancelled", async () => {
    const controller = new AbortController();
    let calls = 0;
    const { result } = await retryWhileFresh(async () => { if (++calls === 2) controller.abort(); return "refused"; }, () => true, Date.now() + 60_000, { pollMs: 1, signal: controller.signal });
    expect(result).toBe("refused");
    expect(calls).toBe(2);
  });
});
