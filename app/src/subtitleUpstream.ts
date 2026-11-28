const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const REDIRECT_LIMIT = 4;
export const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;

function allowedHost(hostname: string): boolean {
  return hostname === "youtube.com"
    || hostname.endsWith(".youtube.com")
    || hostname === "googlevideo.com"
    || hostname.endsWith(".googlevideo.com");
}

/** Validate a caption URL supplied by yt-dlp before any network request. */
export function safeSubtitleUpstreamUrl(candidate: string, base?: string): string | null {
  try {
    const url = base ? new URL(candidate, base) : new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !allowedHost(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Follow a small, revalidated redirect chain without forwarding browser credentials. */
export async function fetchSubtitleUpstream(
  fetchImpl: typeof fetch,
  candidate: string,
  init: RequestInit,
): Promise<Response | null> {
  let current = safeSubtitleUpstreamUrl(candidate);
  if (!current) return null;
  for (let hop = 0; hop <= REDIRECT_LIMIT; hop += 1) {
    const response = await fetchImpl(current, { ...init, redirect: "manual" }).catch(() => null);
    if (!response) return null;
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});
    if (hop === REDIRECT_LIMIT || !location) return null;
    current = safeSubtitleUpstreamUrl(location, current);
    if (!current) return null;
  }
  return null;
}

/** Expose only a bounded WebVTT body, never upstream headers. */
export function proxySubtitleResponse(response: Response, maxBytes = MAX_SUBTITLE_BYTES): Response | null {
  if (!response.ok || !response.body) return null;
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) return null;
  let size = 0;
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > maxBytes) {
        controller.error(new Error("subtitle response exceeded limit"));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
  return new Response(body, { headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "private, max-age=60" } });
}

/**
 * The first of a language's tracks that YouTube serves, as a bounded WebVTT
 * response. YouTube refuses some tracks (a machine translation, under rate
 * limiting) while serving others in the same language.
 */
export async function firstSubtitleResponse(fetchImpl: typeof fetch, candidates: string[], init: RequestInit): Promise<Response | null> {
  for (const candidate of candidates) {
    const upstream = await fetchSubtitleUpstream(fetchImpl, candidate, init);
    const proxied = upstream && proxySubtitleResponse(upstream);
    if (proxied) return proxied;
    await upstream?.body?.cancel().catch(() => {});
    if (init.signal?.aborted) return null;
  }
  return null;
}
