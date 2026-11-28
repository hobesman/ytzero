import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** The audio for one processed stream: answers ffmpeg's range (`bytes=N-`, or none). */
export type LoopbackSource = (range: string | null, signal: AbortSignal) => Promise<Response | null>;

export type LoopbackLink = { url: string; close: () => void };

export type LoopbackAudio = { link: (source: LoopbackSource) => Promise<LoopbackLink> };

/** Longer than any stream; only a link whose close was never called lasts this long. */
const STALE_MS = 12 * 60 * 60 * 1000;

/**
 * Where ffmpeg reads the audio it cuts and levels, on 127.0.0.1 only, one
 * unguessable path per stream.
 *
 * ffmpeg needs the file's size to use the index at its start (the sidx box).
 * Without it, it reads every fragment of the file before the first audio,
 * which for a two-hour video takes longer than the Echo waits. Bun.serve sends
 * a streamed body chunked and drops its Content-Length, whatever the response
 * says; node:http keeps it, so ffmpeg is served from here.
 */
export function createLoopbackAudio(now: () => number = Date.now): LoopbackAudio {
  const sources = new Map<string, { source: LoopbackSource; at: number }>();
  let origin: Promise<string> | null = null;

  async function handle(request: IncomingMessage, reply: ServerResponse) {
    const entry = sources.get((request.url ?? "").replace(/^\//, "").replace(/\?.*$/, ""));
    if (!entry || (request.method !== "GET" && request.method !== "HEAD")) {
      reply.writeHead(404).end();
      return;
    }
    const controller = new AbortController();
    reply.on("close", () => controller.abort());
    const response = await entry.source(request.headers.range ?? null, controller.signal).catch(() => null);
    if (!response) {
      reply.writeHead(502).end();
      return;
    }
    reply.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body || request.method === "HEAD") {
      await response.body?.cancel().catch(() => {});
      reply.end();
      return;
    }
    // A failure part way leaves the body short of its length; ffmpeg asks again from where it stopped.
    await pipeline(Readable.fromWeb(response.body as never), reply).catch(() => reply.destroy());
  }

  function listen(): Promise<string> {
    origin ??= new Promise<string>((resolve, reject) => {
      const server: Server = createServer((request, reply) => void handle(request, reply).catch(() => reply.destroy()));
      server.once("error", (error) => {
        origin = null;
        reject(error);
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        server.unref();
        resolve(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`);
      });
    });
    return origin;
  }

  return {
    async link(source) {
      const at = now();
      for (const [key, entry] of sources) if (at - entry.at > STALE_MS) sources.delete(key);
      const base = await listen();
      const key = randomBytes(16).toString("hex");
      sources.set(key, { source, at });
      return { url: `${base}/${key}`, close: () => sources.delete(key) };
    },
  };
}

export const loopbackAudio = createLoopbackAudio();
