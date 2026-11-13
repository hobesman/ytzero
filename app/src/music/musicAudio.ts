import { parseAudioContentRange, parseAudioRange } from "../audioRange";

/** Bytes fetched ahead for the next song: a few seconds of audio, enough to start at once. */
export const MUSIC_PREPARE_BYTES = 262_144;
const PREPARED_TTL_MS = 3 * 60_000;
const PREPARED_LIMIT = 8;

type AudioResponder = (userId: number, videoId: string, range: string | null, signal?: AbortSignal) => Promise<Response | null>;

export interface MusicAudioDependencies {
  getAudioResponse: AudioResponder;
  getAudioHeadResponse: AudioResponder;
  now?: () => number;
}

interface PreparedPrefix {
  at: number;
  body: ArrayBuffer;
  mime: string;
  total: number;
}

/**
 * Music playback on top of the shared audio proxy. The proxy keeps no viewing
 * state, so nothing here touches watch history or the video catalog.
 */
export function createMusicAudio(dependencies: MusicAudioDependencies) {
  const now = dependencies.now ?? Date.now;
  const prepared = new Map<string, PreparedPrefix>();
  const pending = new Map<string, Promise<boolean>>();

  const key = (userId: number, videoId: string) => `${userId}:${videoId}`;

  function freshPrefix(userId: number, videoId: string): PreparedPrefix | null {
    const entry = prepared.get(key(userId, videoId));
    if (!entry) return null;
    if (now() - entry.at > PREPARED_TTL_MS) {
      prepared.delete(key(userId, videoId));
      return null;
    }
    return entry;
  }

  /** Resolve the song's audio address and keep its first bytes in memory. */
  async function prepare(userId: number, videoId: string): Promise<boolean> {
    if (freshPrefix(userId, videoId)) return true;
    const id = key(userId, videoId);
    const running = pending.get(id);
    if (running) return running;
    const task = (async () => {
      const response = await dependencies.getAudioResponse(userId, videoId, `bytes=0-${MUSIC_PREPARE_BYTES - 1}`);
      const range = parseAudioContentRange(response?.headers.get("content-range") ?? null);
      if (!response || response.status !== 206 || !range || range.start !== 0) {
        await response?.body?.cancel().catch(() => {});
        return false;
      }
      const body = await response.arrayBuffer();
      prepared.delete(id);
      prepared.set(id, { at: now(), body, mime: response.headers.get("content-type") ?? "audio/mp4", total: range.total });
      while (prepared.size > PREPARED_LIMIT) prepared.delete(prepared.keys().next().value!);
      return true;
    })().catch(() => false).finally(() => pending.delete(id));
    pending.set(id, task);
    return task;
  }

  /**
   * A request from the start of a prepared song gets its whole range: the
   * prefix from memory at once, then the rest from upstream. A shorter answer
   * would make the player take the prefix for the whole file.
   */
  function preparedResponse(userId: number, videoId: string, rangeHeader: string | null, signal?: AbortSignal): Response | null {
    const range = parseAudioRange(rangeHeader);
    if (!range || range.start !== 0) return null;
    const entry = freshPrefix(userId, videoId);
    if (!entry) return null;
    const end = Math.min(range.end, entry.total - 1);
    const prefixLength = entry.body.byteLength;
    const body = end < prefixLength ? entry.body.slice(0, end + 1) : new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(entry.body)); },
      async pull(controller) {
        const rest = await dependencies.getAudioResponse(userId, videoId, `bytes=${prefixLength}-${end}`, signal);
        const restRange = parseAudioContentRange(rest?.headers.get("content-range") ?? null);
        if (!rest?.body || rest.status !== 206 || !restRange || restRange.start !== prefixLength || restRange.end !== end) {
          await rest?.body?.cancel().catch(() => {});
          controller.error(new Error("music audio upstream did not return the rest of the song"));
          return;
        }
        const reader = rest.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
      cancel() { /* The upstream request follows `signal`. */ },
    }, { highWaterMark: 0 });
    return new Response(body, {
      status: 206,
      headers: {
        "Content-Type": entry.mime,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Length": String(end + 1),
        "Content-Range": `bytes 0-${end}/${entry.total}`,
      },
    });
  }

  async function audio(userId: number, videoId: string, rangeHeader: string | null, signal?: AbortSignal): Promise<Response | null> {
    return preparedResponse(userId, videoId, rangeHeader, signal)
      ?? await dependencies.getAudioResponse(userId, videoId, rangeHeader, signal);
  }

  async function head(userId: number, videoId: string, rangeHeader: string | null, signal?: AbortSignal): Promise<Response | null> {
    const entry = freshPrefix(userId, videoId);
    if (entry) {
      return new Response(null, {
        status: 200,
        headers: { "Content-Type": entry.mime, "Accept-Ranges": "bytes", "Cache-Control": "no-store", "Content-Length": String(entry.total) },
      });
    }
    return await dependencies.getAudioHeadResponse(userId, videoId, rangeHeader, signal);
  }

  return { prepare, audio, head };
}

export type MusicAudio = ReturnType<typeof createMusicAudio>;
