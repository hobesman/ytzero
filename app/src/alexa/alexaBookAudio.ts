import { createHmac, timingSafeEqual } from "node:crypto";
import { isBookId } from "../audiobookshelf/audiobookshelfClient";
import { ALEXA_AUDIO_LINK_TTL_MS } from "./alexaAudioLinks";

/**
 * A book's audio for an Echo. Alexa fetches it from Amazon's cloud with no
 * cookie, so each link carries its own signature, like the music and video
 * audio, and the Echo never sees Audiobookshelf or its key.
 *
 * An Echo plays a stream from the stream's own start whatever offset it is
 * sent, then reports that offset plus the time played (learnt on the video
 * skill). So a book file is served starting at the place asked for (`t`,
 * seconds, unsigned: any place in the file is allowed), and the Play
 * directive sends that same place as its offset. ffmpeg does the cutting: it
 * reads the file from Audiobookshelf with ranges, seeks, and writes
 * fragmented MP4. AAC (M4B, M4A) is copied as it is; anything else (MP3,
 * Opus, FLAC…) is converted to AAC on the way through, so every book stream
 * is the one format an Echo is known to play from this server.
 */

function signature(secret: string, bookId: string, fileIndex: number, userId: number, expires: number): string {
  return createHmac("sha256", secret).update(`alexa-book-audio\n${bookId}\n${fileIndex}\n${userId}\n${expires}`).digest("base64url");
}

function coverSignature(secret: string, bookId: string): string {
  return createHmac("sha256", secret).update(`alexa-book-cover\n${bookId}`).digest("base64url");
}

export function alexaBookAudioLink(publicUrl: string, secret: string, bookId: string, fileIndex: number, userId: number, startSeconds = 0, now = Date.now()): string {
  const expires = Math.floor((now + ALEXA_AUDIO_LINK_TTL_MS) / 1000);
  const query = new URLSearchParams({ u: String(userId), e: String(expires), s: signature(secret, bookId, fileIndex, userId, expires) });
  if (startSeconds > 0) query.set("t", String(Math.round(startSeconds * 1000) / 1000));
  return `${publicUrl}/alexa/book-audio/${bookId}/${fileIndex}?${query}`;
}

/** The profile a link plays as, or null when it is forged, altered or expired. */
export function verifyAlexaBookAudioLink(secret: string, bookId: string, fileIndex: number, query: URLSearchParams, now = Date.now()): number | null {
  if (!isBookId(bookId) || !Number.isSafeInteger(fileIndex) || fileIndex < 0) return null;
  const userId = Number(query.get("u"));
  const expires = Number(query.get("e"));
  const given = Buffer.from(query.get("s") ?? "");
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(expires) || expires * 1000 <= now) return null;
  const expected = Buffer.from(signature(secret, bookId, fileIndex, userId, expires));
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
}

/**
 * A cover for the Echo's screen and the tablet. Covers aren't private enough
 * to expire: a now-playing record keeps its art for as long as it is shown.
 */
export function alexaBookCoverLink(publicUrl: string, secret: string, bookId: string): string {
  return `${publicUrl}/alexa/book-cover/${bookId}?s=${coverSignature(secret, bookId)}`;
}

export function verifyAlexaBookCoverLink(secret: string, bookId: string, query: URLSearchParams): boolean {
  if (!isBookId(bookId)) return false;
  const given = Buffer.from(query.get("s") ?? "");
  const expected = Buffer.from(coverSignature(secret, bookId));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The stream path in a Play directive's URL: the book and the file index. */
export const BOOK_AUDIO_PATH = /\/book-audio\/([A-Za-z0-9_-]{1,64})\/(\d{1,4})(?:[?#]|$)/;

/** Codecs copied as they are; everything else is converted. */
const COPIED_CODECS = new Set(["aac"]);
const CONVERTED_BITRATE = "96k";

/** ffmpeg's arguments for one file from `startSeconds`. The source's headers carry the API key: never log these. */
export function bookStreamArgs(source: { url: string; headers: Record<string, string> }, codec: string, startSeconds: number): string[] {
  const headers = Object.entries(source.headers).map(([name, value]) => `${name}: ${value}\r\n`).join("");
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-reconnect", "1", "-reconnect_on_network_error", "1", "-reconnect_delay_max", "5",
    ...(headers ? ["-headers", headers] : []),
    ...(startSeconds > 0 ? ["-ss", String(Math.round(startSeconds * 1000) / 1000)] : []),
    "-i", source.url,
    "-map", "0:a:0", "-vn", "-sn", "-dn",
    ...(COPIED_CODECS.has(codec) ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", CONVERTED_BITRATE]),
    "-f", "mp4", "-movflags", "empty_moov+default_base_moof", "-frag_duration", "2000000",
    "pipe:1",
  ];
}

export type SpawnFfmpeg = (args: string[]) => { stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array>; kill: () => void; exited: Promise<number> };

const defaultSpawn: SpawnFfmpeg = (args) => {
  const child = Bun.spawn(["ffmpeg", ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return { stdout: child.stdout, stderr: child.stderr, kill: () => child.kill(), exited: child.exited };
};

/** How long the first audio may take: ffmpeg has to open the file and seek over the network. */
const FIRST_BYTES_WAIT_MS = 20_000;

/**
 * The stream as a 200 response, once ffmpeg has produced its first bytes, or
 * a 502 with ffmpeg's complaint (first line only, never the arguments) when it
 * can't. The stream ends with the request; `onClose` hears how: `ended`
 * when the whole file went out, otherwise the Echo let go of it first.
 */
export function bookStreamResponse(
  source: { url: string; headers: Record<string, string> },
  codec: string,
  startSeconds: number,
  signal?: AbortSignal,
  spawn: SpawnFfmpeg = defaultSpawn,
  onClose?: (outcome: { ended: boolean; bytes: number }) => void,
): Promise<{ response: Response; error?: string }> {
  return ffmpegStreamResponse(bookStreamArgs(source, codec, startSeconds), signal, spawn, onClose);
}

/** ffmpeg's output as an fMP4 response, for any arguments that write it to stdout; see bookStreamResponse. */
export async function ffmpegStreamResponse(
  args: string[],
  signal?: AbortSignal,
  spawn: SpawnFfmpeg = defaultSpawn,
  onClose?: (outcome: { ended: boolean; bytes: number }) => void,
): Promise<{ response: Response; error?: string }> {
  const child = spawn(args);
  let bytes = 0;
  let closed = false;
  const close = (ended: boolean) => { if (!closed) { closed = true; onClose?.({ ended, bytes }); } };
  const stop = () => { try { child.kill(); } catch { /* already gone */ } close(false); };
  signal?.addEventListener("abort", stop, { once: true });
  const reader = child.stdout.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const first = await Promise.race([
    reader.read(),
    new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), FIRST_BYTES_WAIT_MS); }),
  ]).finally(() => clearTimeout(timer));
  if (first === "timeout" || first.done) {
    closed = true;
    stop();
    const complaint = first === "timeout" ? "ffmpeg produced no audio in time" : (await new Response(child.stderr).text().catch(() => "")).split("\n")[0]?.trim() || "ffmpeg produced no audio";
    signal?.removeEventListener("abort", stop);
    return { response: new Response(JSON.stringify({ error: "audio unavailable" }), { status: 502, headers: { "Content-Type": "application/json" } }), error: complaint.slice(0, 200) };
  }
  // Drained so ffmpeg never blocks on a full stderr pipe.
  void new Response(child.stderr).arrayBuffer().catch(() => {});
  const body = new ReadableStream<Uint8Array>({
    start(controller) { bytes += first.value.byteLength; controller.enqueue(first.value); },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          close(!signal?.aborted);
          controller.close();
        } else {
          bytes += value.byteLength;
          controller.enqueue(value);
        }
      } catch (error) {
        close(false);
        controller.error(error);
      }
    },
    cancel() { stop(); },
  }, { highWaterMark: 0 });
  return { response: new Response(body, { status: 200, headers: { "Content-Type": "audio/mp4", "Cache-Control": "no-store" } }) };
}
