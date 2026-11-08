import { describe, expect, test } from "bun:test";
import { createLoginThrottle, LOGIN_FAILURES_PER_ADDRESS, LOGIN_FAILURES_PER_USERNAME, LOGIN_WINDOW_MS, loginClientAddress } from "./loginThrottle";

describe("login throttle", () => {
  test("locks a username from one address after repeated failures, until the window passes", () => {
    let time = 1_000_000;
    const throttle = createLoginThrottle(() => time);
    for (let attempt = 0; attempt < LOGIN_FAILURES_PER_USERNAME; attempt++) {
      expect(throttle.retryAfter("1.2.3.4", "Nick")).toBe(0);
      throttle.fail("1.2.3.4", "Nick");
    }
    expect(throttle.retryAfter("1.2.3.4", "nick")).toBe(LOGIN_WINDOW_MS / 1000);
    expect(throttle.retryAfter("5.6.7.8", "nick")).toBe(0);
    time += LOGIN_WINDOW_MS;
    expect(throttle.retryAfter("1.2.3.4", "nick")).toBe(0);
  });

  test("a success clears that username's failures", () => {
    const throttle = createLoginThrottle(() => 0);
    for (let attempt = 0; attempt < LOGIN_FAILURES_PER_USERNAME - 1; attempt++) throttle.fail("1.2.3.4", "nick");
    throttle.succeed("1.2.3.4", "nick");
    throttle.fail("1.2.3.4", "nick");
    expect(throttle.retryAfter("1.2.3.4", "nick")).toBe(0);
  });

  test("limits one address guessing across many usernames", () => {
    const throttle = createLoginThrottle(() => 0);
    for (let attempt = 0; attempt < LOGIN_FAILURES_PER_ADDRESS; attempt++) throttle.fail("1.2.3.4", `user${attempt}`);
    expect(throttle.retryAfter("1.2.3.4", "someone-new")).toBeGreaterThan(0);
  });

  test("reads the address the proxy forwards", () => {
    const headers: Record<string, string> = { "x-forwarded-for": "203.0.113.9, 10.0.0.1" };
    expect(loginClientAddress((name) => headers[name])).toBe("203.0.113.9");
    expect(loginClientAddress(() => undefined)).toBe("unknown");
  });
});
