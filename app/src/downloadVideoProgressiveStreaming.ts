import { audioRangeHeader, parseAudioRange, parseAudioUnsatisfiedTotal, validateAudioRangeResponse } from "./audioRange";
import { fetchGoogleVideoResponse, safeGoogleVideoUrl } from "./audioUpstreamUrl";
import { downloadCookieAttempts, isAnonymousAddressRefusal, recordDownloadAttempt } from "./downloadStrategy";
import { ytdlpAttemptArgs } from "./downloadConfig";
import { freshUrlDeadline, FRESH_URL_POLL_MS, parseAvailableAt, retryWhileFresh } from "./freshStreamUrl";
import { parseYtdlpHttpHeaders, rangedYtdlpHeaders, type YtdlpHttpHeaders } from "./ytdlpHttpHeaders";

interface Dependencies {
  YTDLP: string;
  downloadCookiesConfigured: (userId: number) => boolean;
  downloadCookiesFile: (userId: number) => string;
  ytdlpStatus: () => Promise<string | null>;
  dlSettings?: (userId: number) => Promise<{ quality: string }>;
  fetchImpl?: typeof fetch;
  spawn?: typeof Bun.spawn;
  now?: () => number;
  /** Time between retries of a refused just-issued address; tests shorten it. */
  freshUrlPollMs?: number;
  /** More yt-dlp arguments, e.g. a YouTube client to ask. */
  extraArgs?: string[];
  /**
   * Whether a refused address is looked up again (default). A source YouTube
   * serves only in part (the fast-start bridge) answers its refusal at once instead.
   */
  refreshOnRefusal?: boolean;
}

/** How long prepareDirectVideo waits for a new address to go live. */
const PREPARE_LIVE_WAIT_MS = 4_000;

interface Source {
  url: string;
  expiresAt: number;
  issuedAt: number;
  /** When YouTube starts serving the address, as yt-dlp reports; null when it says nothing. */
  availableAt: number | null;
  httpHeaders: YtdlpHttpHeaders;
}

interface Resolution {
  controller: AbortController;
  promise: Promise<Source | null>;
  waiters: number;
  settled: boolean;
}

const CHUNK_BYTES = 8 * 1024 * 1024;
const RESOLVE_TIMEOUT_MS = 30_000;
const RANGE_TIMEOUT_MS = 45_000;
const MAX_BUFFERED_REQUESTS = 4;

function keyFor(userId: number, videoId: string) { return `${userId}:${videoId}`; }

function sourceExpiry(url: string, now: number): number {
  try {
    const expire = Number(new URL(url).searchParams.get("expire"));
    if (Number.isFinite(expire) && expire > 0) return Math.max(now, expire * 1_000 - 300_000);
  } catch {}
  return now + 3 * 60 * 60_000;
}

function abortSignal(parent: AbortSignal | undefined, timeoutMs: number, message: string) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(message)), timeoutMs);
  timer.unref?.();
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener("abort", abort); } };
}

export function createDownloadVideoProgressiveStreaming(dependencies: Dependencies) {
  const {
    YTDLP, downloadCookiesConfigured, downloadCookiesFile, ytdlpStatus,
    dlSettings = async () => ({ quality: "best" }),
    fetchImpl = fetch, spawn = Bun.spawn, now = Date.now, freshUrlPollMs = FRESH_URL_POLL_MS,
    extraArgs = [], refreshOnRefusal = true,
  } = dependencies;
  const sources = new Map<string, Source>();
  const resolutions = new Map<string, Resolution>();
  const bufferedRequests = new Map<number, number>();

  async function resolveAttempt(userId: number, videoId: string, useCookies: boolean, signal: AbortSignal): Promise<{ source: Source | null; refused: boolean }> {
    const quality = Number((await dlSettings(userId)).quality);
    if (signal.aborted) return { source: null, refused: false };
    const height = Number.isFinite(quality) && quality > 0 ? Math.min(Math.floor(quality), 720) : 720;
    const args = [
      `https://www.youtube.com/watch?v=${videoId}`, "--ignore-config", "--no-playlist", "--no-warnings", "--skip-download",
      "-f", `best[ext=mp4][vcodec^=avc1][acodec^=mp4a][protocol^=http][height<=${height}]`,
      "--print", "urls", "--print", "%(ext)s", "--print", "%(vcodec)s", "--print", "%(acodec)s",
      "--print", "%(http_headers)j", "--print", "%(available_at)s",
      ...extraArgs,
    ];
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = spawn([YTDLP, ...ytdlpAttemptArgs(args, useCookies, useCookies ? downloadCookiesFile(userId) : null)], { stdout: "pipe", stderr: "pipe" });
    } catch { return { source: null, refused: false }; }
    const stop = () => { try { proc.kill(); } catch {} };
    signal.addEventListener("abort", stop, { once: true });
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
        new Response(proc.stderr as ReadableStream<Uint8Array>).text(), proc.exited,
      ]);
      if (signal.aborted || code !== 0) {
        return { source: null, refused: !useCookies && isAnonymousAddressRefusal(stderr) };
      }
      // `available_at` prints last ("NA" when yt-dlp has none), so older output still parses.
      const [candidate, ext, vcodec, acodec, serializedHeaders, availableAt] = stdout.trim().split(/\r?\n/);
      const url = safeGoogleVideoUrl(candidate ?? "");
      const httpHeaders = parseYtdlpHttpHeaders(serializedHeaders ?? "");
      if (!url || !httpHeaders || ext !== "mp4" || !vcodec?.startsWith("avc1") || !acodec?.startsWith("mp4a")) return { source: null, refused: false };
      const issuedAt = now();
      return { source: { url, expiresAt: sourceExpiry(url, issuedAt), issuedAt, availableAt: parseAvailableAt(availableAt), httpHeaders }, refused: false };
    } finally {
      signal.removeEventListener("abort", stop);
    }
  }

  async function resolveFresh(userId: number, videoId: string, signal: AbortSignal): Promise<Source | null> {
    if (!(await ytdlpStatus()) || signal.aborted) return null;
    let refused = false;
    for (const useCookies of downloadCookieAttempts(downloadCookiesConfigured(userId), userId)) {
      const result = await resolveAttempt(userId, videoId, useCookies, signal);
      refused ||= result.refused;
      if (result.source) { recordDownloadAttempt(userId, useCookies, true, refused); return result.source; }
      if (signal.aborted) return null;
    }
    return null;
  }

  function waitFor(key: string, resolution: Resolution, signal?: AbortSignal): Promise<Source | null> {
    if (signal?.aborted) return Promise.resolve(null);
    resolution.waiters++;
    return new Promise((resolve) => {
      let done = false;
      const finish = (source: Source | null) => {
        if (done) return;
        done = true;
        signal?.removeEventListener("abort", onAbort);
        resolution.waiters = Math.max(0, resolution.waiters - 1);
        if (resolution.waiters === 0 && !resolution.settled && resolutions.get(key) === resolution) {
          resolutions.delete(key); resolution.controller.abort();
        }
        resolve(signal?.aborted ? null : source);
      };
      const onAbort = () => finish(null);
      signal?.addEventListener("abort", onAbort, { once: true });
      resolution.promise.then(finish, () => finish(null));
    });
  }

  async function resolveSource(userId: number, videoId: string, signal?: AbortSignal, force = false): Promise<Source | null> {
    const key = keyFor(userId, videoId);
    const cached = sources.get(key);
    if (!force && cached && cached.expiresAt > now()) return cached;
    if (cached) sources.delete(key);
    let resolution = resolutions.get(key);
    if (!resolution || force) {
      if (resolution && force) resolution.controller.abort();
      const controller = new AbortController();
      resolution = { controller, promise: Promise.resolve(null), waiters: 0, settled: false };
      const current = resolution;
      current.promise = (async () => {
        const operation = abortSignal(controller.signal, RESOLVE_TIMEOUT_MS, "direct video source timeout");
        try { return await resolveFresh(userId, videoId, operation.signal); } finally { operation.dispose(); }
      })().then((source) => {
        if (source && !controller.signal.aborted) sources.set(key, source);
        return controller.signal.aborted ? null : source;
      }).finally(() => { current.settled = true; if (resolutions.get(key) === current) resolutions.delete(key); });
      resolutions.set(key, current);
    }
    return waitFor(key, resolution, signal);
  }

  function notSatisfiable(total?: number): Response {
    const headers = new Headers({ "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
    if (total != null) headers.set("Content-Range", `bytes */${total}`);
    return new Response(null, { status: 416, headers });
  }

  async function response(userId: number, videoId: string, rangeValue: string | null, signal?: AbortSignal): Promise<Response | null> {
    const range = parseAudioRange(rangeValue, CHUNK_BYTES);
    if (!range) return notSatisfiable();
    const active = bufferedRequests.get(userId) ?? 0;
    if (active >= MAX_BUFFERED_REQUESTS) return new Response(null, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "1" } });
    bufferedRequests.set(userId, active + 1);
    try {
      let source = await resolveSource(userId, videoId, signal);
      if (!source) return null;
      const fetchRange = async (candidate: Source) => {
        const operation = abortSignal(signal, RANGE_TIMEOUT_MS, "direct video range timeout");
        try { return await fetchGoogleVideoResponse(fetchImpl, candidate.url, { headers: rangedYtdlpHeaders(candidate.httpHeaders, audioRangeHeader(range)), signal: operation.signal }); }
        finally { operation.dispose(); }
      };
      // A refused new address is retried as it is until YouTube serves it (see freshStreamUrl.ts).
      const fresh = source;
      let upstream = (await retryWhileFresh(
        () => fetchRange(fresh),
        (attempt) => {
          if (attempt?.status !== 403) return false;
          void attempt.body?.cancel().catch(() => {});
          return true;
        },
        freshUrlDeadline(fresh.issuedAt, fresh.availableAt),
        { now, pollMs: freshUrlPollMs, signal },
      )).result;
      if (signal?.aborted) return null;
      if (upstream && [403, 404, 410].includes(upstream.status)) {
        await upstream.body?.cancel().catch(() => {});
        if (!refreshOnRefusal) return new Response(null, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
        source = await resolveSource(userId, videoId, signal, true);
        if (!source) return null;
        upstream = await fetchRange(source);
      }
      if (!upstream) return null;
      if (upstream.status === 416) {
        const total = parseAudioUnsatisfiedTotal(upstream.headers.get("content-range"));
        await upstream.body?.cancel().catch(() => {});
        return notSatisfiable(total ?? undefined);
      }
      const contentRange = validateAudioRangeResponse(upstream.status, upstream.headers.get("content-range"), upstream.headers.get("content-length"), range);
      if (!contentRange || !upstream.body) { await upstream.body?.cancel().catch(() => {}); return null; }
      const body = await upstream.arrayBuffer().catch(() => null);
      const length = contentRange.end - contentRange.start + 1;
      if (!body || body.byteLength !== length || signal?.aborted) return null;
      return new Response(body, { status: 206, headers: {
        "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "no-store",
        "Content-Length": String(length), "Content-Range": `bytes ${contentRange.start}-${contentRange.end}/${contentRange.total}`,
      } });
    } finally {
      const remaining = (bufferedRequests.get(userId) ?? 1) - 1;
      if (remaining > 0) bufferedRequests.set(userId, remaining); else bufferedRequests.delete(userId);
    }
  }

  function invalidateDirectVideoSources(userId: number) {
    const prefix = `${userId}:`;
    for (const key of sources.keys()) if (key.startsWith(prefix)) sources.delete(key);
    for (const [key, resolution] of resolutions) if (key.startsWith(prefix)) { resolutions.delete(key); resolution.controller.abort(); }
  }

  /**
   * Looks the video up and checks that YouTube already serves its start, so a
   * player given it starts at once. False when it cannot within a few seconds.
   */
  async function prepareDirectVideo(userId: number, videoId: string, signal?: AbortSignal): Promise<boolean> {
    const source = await resolveSource(userId, videoId, signal);
    if (!source || signal?.aborted) return false;
    const { result } = await retryWhileFresh(
      async () => {
        const operation = abortSignal(signal, RANGE_TIMEOUT_MS, "direct video range timeout");
        try {
          const upstream = await fetchGoogleVideoResponse(fetchImpl, source.url, { headers: rangedYtdlpHeaders(source.httpHeaders, "bytes=0-1"), signal: operation.signal });
          await upstream?.body?.cancel().catch(() => {});
          return upstream?.status ?? 0;
        } finally { operation.dispose(); }
      },
      (status) => status === 403,
      Math.min(freshUrlDeadline(source.issuedAt, source.availableAt), now() + PREPARE_LIVE_WAIT_MS),
      { now, pollMs: freshUrlPollMs, signal },
    );
    return result === 206;
  }

  return { getDirectVideoResponse: response, invalidateDirectVideoSources, prepareDirectVideo };
}
