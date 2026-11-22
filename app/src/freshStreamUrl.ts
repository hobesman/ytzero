/**
 * Googlevideo refuses a just-issued stream address (403) until a moment yt-dlp
 * reports as the format's `available_at`, then serves it for its whole life
 * (about six hours). On the live server that moment ranged from 2 to 29 seconds
 * after the lookup, video to video. Looking the video up again only issues a
 * new address with a new wait, so a refused new address is retried as it is,
 * every couple of seconds, and plays as soon as YouTube lets it.
 */

/** Time between retries of a refused new address. */
export const FRESH_URL_POLL_MS = 2_000;
/** How long past `available_at` a refusal is still taken for the wait. */
const FRESH_URL_GRACE_MS = 5_000;
/** How long a new address is retried when yt-dlp gives no `available_at`. */
const FRESH_URL_UNKNOWN_WAIT_MS = 8_000;
/** No new address is waited on longer than this, whatever yt-dlp says. */
const FRESH_URL_MAX_WAIT_MS = 45_000;

/** yt-dlp's `available_at` (Unix seconds) as milliseconds, or null. */
export function parseAvailableAt(value: unknown): number | null {
  const seconds = typeof value === "number" ? value : typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
}

/** Until when a 403 from an address issued at `issuedAt` means "not live yet" rather than refused. */
export function freshUrlDeadline(issuedAt: number, availableAt: number | null): number {
  const expected = availableAt == null ? issuedAt + FRESH_URL_UNKNOWN_WAIT_MS : availableAt + FRESH_URL_GRACE_MS;
  return Math.min(issuedAt + FRESH_URL_MAX_WAIT_MS, Math.max(issuedAt + FRESH_URL_UNKNOWN_WAIT_MS, expected));
}

function pause(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (completed: boolean) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(completed);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs `attempt`, and while its result is a refusal and the address is still
 * within its wait, runs it again every `pollMs`. Returns the last result and
 * how long was spent waiting.
 */
export async function retryWhileFresh<T>(
  attempt: () => Promise<T>,
  refused: (result: T) => boolean,
  deadline: number,
  options: { now?: () => number; pollMs?: number; signal?: AbortSignal } = {},
): Promise<{ result: T; waitedMs: number }> {
  const { now = Date.now, pollMs = FRESH_URL_POLL_MS, signal } = options;
  const started = now();
  // Also bounded by count (as many tries as the real interval allows), so a
  // clock that stands still, or a shortened interval in tests, stays bounded.
  let retries = Math.ceil(Math.max(0, deadline - started) / Math.max(pollMs, FRESH_URL_POLL_MS));
  let result = await attempt();
  while (refused(result) && !signal?.aborted && retries-- > 0) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    if (!await pause(Math.min(pollMs, remaining), signal)) break;
    result = await attempt();
  }
  return { result, waitedMs: Math.max(0, now() - started) };
}
