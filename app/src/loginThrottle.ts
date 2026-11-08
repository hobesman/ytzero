/**
 * Slows password guessing. Failed sign-ins are counted per client address and
 * username, and per address across all usernames, within a window; past the
 * limit the address waits out the window. A success clears that username's count.
 * State is in memory: a restart forgets it, which only shortens a lockout.
 */
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_FAILURES_PER_USERNAME = 5;
export const LOGIN_FAILURES_PER_ADDRESS = 20;
const MAX_TRACKED = 10_000;

type Entry = { failures: number; windowStart: number };

export function createLoginThrottle(now: () => number = Date.now) {
  const entries = new Map<string, Entry>();
  const userKey = (address: string, username: string) => `u:${address}:${username.trim().toLowerCase()}`;
  const addressKey = (address: string) => `a:${address}`;
  const current = (key: string): Entry | null => {
    const entry = entries.get(key);
    if (!entry) return null;
    if (now() - entry.windowStart >= LOGIN_WINDOW_MS) { entries.delete(key); return null; }
    return entry;
  };
  const wait = (entry: Entry | null, limit: number) =>
    entry && entry.failures >= limit ? Math.max(1, Math.ceil((entry.windowStart + LOGIN_WINDOW_MS - now()) / 1000)) : 0;
  const count = (key: string) => {
    const entry = current(key);
    if (entry) { entry.failures += 1; return; }
    if (entries.size >= MAX_TRACKED) {
      for (const [stale, value] of entries) if (now() - value.windowStart >= LOGIN_WINDOW_MS) entries.delete(stale);
      if (entries.size >= MAX_TRACKED) entries.delete(entries.keys().next().value!);
    }
    entries.set(key, { failures: 1, windowStart: now() });
  };
  return {
    /** Seconds this address must wait before trying this username, or 0. */
    retryAfter: (address: string, username: string) => Math.max(
      wait(current(userKey(address, username)), LOGIN_FAILURES_PER_USERNAME),
      wait(current(addressKey(address)), LOGIN_FAILURES_PER_ADDRESS),
    ),
    fail: (address: string, username: string) => { count(userKey(address, username)); count(addressKey(address)); },
    succeed: (address: string, username: string) => { entries.delete(userKey(address, username)); },
  };
}

export const loginThrottle = createLoginThrottle();

/** The client's address as the reverse proxy reports it. */
export function loginClientAddress(header: (name: string) => string | undefined): string {
  return header("cf-connecting-ip")?.trim()
    || header("x-forwarded-for")?.split(",")[0]?.trim()
    || header("x-real-ip")?.trim()
    || "unknown";
}
