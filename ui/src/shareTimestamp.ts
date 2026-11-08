/** Read a `?t=` start time in whole seconds from a share link's query string. */
export function parseShareTimestamp(search: string): number {
  const seconds = Number(new URLSearchParams(search).get("t"));
  return Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
}

/** Add a `t` start time to a share link, or return it unchanged for zero. */
export function withShareTimestamp(link: string, seconds: number | undefined): string {
  const start = Math.floor(seconds ?? 0);
  if (!Number.isFinite(start) || start <= 0) return link;
  try {
    const url = new URL(link);
    url.searchParams.set("t", String(start));
    return url.toString();
  } catch {
    return link;
  }
}
