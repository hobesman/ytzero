function positiveMilliseconds(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Upper bound for one YouTube request. Without it, a connection YouTube
 * stops answering hangs its caller forever: a full channel sync then spins
 * indefinitely, and every later sync for that profile queues behind it. */
const YOUTUBE_FETCH_TIMEOUT_MS = positiveMilliseconds(process.env.YOUTUBE_FETCH_TIMEOUT_MS, 30_000);

/** `fetch` for YouTube requests: aborts after YOUTUBE_FETCH_TIMEOUT_MS unless
 * the caller passes its own signal, and names the timed-out path. */
export async function youtubeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(YOUTUBE_FETCH_TIMEOUT_MS) });
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "TimeoutError") {
      throw new Error(`YouTube request timed out after ${Math.round(YOUTUBE_FETCH_TIMEOUT_MS / 1_000)}s (${new URL(url).pathname})`);
    }
    throw error;
  }
}
