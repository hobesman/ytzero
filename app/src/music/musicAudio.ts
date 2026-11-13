import { parseAudioContentRange, parseAudioRange } from "../audioRange";

/** Bytes fetched ahead for the next song: a few seconds of audio, enough to start at once. */
export const MUSIC_PREPARE_BYTES = 262_144;
const PREPARED_TTL_MS = 3 * 60_000;
const PREPARED_LIMIT = 8;
/** Each later piece fetched while a song streams: about a minute of audio. */
export const MUSIC_STREAM_PIECE_BYTES = 1_048_576;

type AudioResponder = (userId: number, videoId: string, range: string | null, signal?: AbortSignal) => Promise<Response | null>;

export interface MusicAudioDependencies {
  getAudioResponse: AudioResponder;
  getAudioHeadResponse: AudioResponder;
  now?: () => number;
}

interface StartBytes {
  start: number;
  body: ArrayBuffer;
  mime: string;
  total: number;
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
   * Answer a range whose first bytes are already in hand: those at once, then
   * the rest from upstream a piece at a time. The headers promise the whole
   * range, since a shorter answer would make the player take it for the whole
   * file, and small pieces keep any one upstream fetch from holding playback:
   * the upstream proxy reads a whole range before it answers.
   */
  function streamedResponse(userId: number, videoId: string, first: StartBytes, end: number, signal?: AbortSignal): Response {
    const firstEnd = first.start + first.body.byteLength - 1;
    let next = firstEnd + 1;
    const body = end <= firstEnd ? first.body.slice(0, end - first.start + 1) : new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(first.body)); },
      async pull(controller) {
        const from = next;
        const to = Math.min(end, from + MUSIC_STREAM_PIECE_BYTES - 1);
        const piece = await dependencies.getAudioResponse(userId, videoId, `bytes=${from}-${to}`, signal);
        const pieceRange = parseAudioContentRange(piece?.headers.get("content-range") ?? null);
        if (!piece?.body || piece.status !== 206 || !pieceRange || pieceRange.start !== from || pieceRange.end !== to) {
          await piece?.body?.cancel().catch(() => {});
          controller.error(new Error("music audio upstream did not return the rest of the song"));
          return;
        }
        try {
          controller.enqueue(new Uint8Array(await piece.arrayBuffer()));
        } catch (error) {
          controller.error(error);
          return;
        }
        next = to + 1;
        if (next > end) controller.close();
      },
      cancel() { /* The upstream request follows `signal`. */ },
    }, { highWaterMark: 0 });
    return new Response(body, {
      status: 206,
      headers: {
        "Content-Type": first.mime,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Length": String(end - first.start + 1),
        "Content-Range": `bytes ${first.start}-${end}/${first.total}`,
      },
    });
  }

  /**
   * A song's audio. A prepared song starts from memory; any other range, such
   * as a seek past a skipped intro, starts with a small piece from upstream
   * instead of waiting for the whole rest of the song.
   */
  async function audio(userId: number, videoId: string, rangeHeader: string | null, signal?: AbortSignal): Promise<Response | null> {
    const range = parseAudioRange(rangeHeader);
    if (!range) return await dependencies.getAudioResponse(userId, videoId, rangeHeader, signal);
    const entry = range.start === 0 ? freshPrefix(userId, videoId) : null;
    if (entry) {
      const start = { start: 0, body: entry.body, mime: entry.mime, total: entry.total };
      return streamedResponse(userId, videoId, start, Math.min(range.end, entry.total - 1), signal);
    }
    const firstEnd = range.start + MUSIC_PREPARE_BYTES - 1;
    if (firstEnd >= range.end) return await dependencies.getAudioResponse(userId, videoId, rangeHeader, signal);
    const first = await dependencies.getAudioResponse(userId, videoId, `bytes=${range.start}-${firstEnd}`, signal);
    const firstRange = parseAudioContentRange(first?.headers.get("content-range") ?? null);
    // Failures, and a song that ends inside the first piece, pass through as they are.
    if (!first || first.status !== 206 || !firstRange || firstRange.start !== range.start || firstRange.end !== firstEnd) return first;
    const start = { start: range.start, body: await first.arrayBuffer(), mime: first.headers.get("content-type") ?? "audio/mp4", total: firstRange.total };
    return streamedResponse(userId, videoId, start, Math.min(range.end, firstRange.total - 1), signal);
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
