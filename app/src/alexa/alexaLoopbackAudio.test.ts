import { describe, expect, test } from "bun:test";
import { createConnection } from "node:net";
import { createLoopbackAudio } from "./alexaLoopbackAudio";

/** The response's head and body as ffmpeg's socket sees them. */
function raw(url: string, range?: string): Promise<{ head: string; body: string }> {
  const { port, pathname } = new URL(url);
  return new Promise((resolve, reject) => {
    let got = "";
    const socket = createConnection(Number(port), "127.0.0.1", () => {
      socket.write(`GET ${pathname} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n${range ? `Range: ${range}\r\n` : ""}\r\n`);
    });
    socket.on("data", (data) => { got += data.toString("latin1"); });
    socket.on("error", reject);
    socket.on("close", () => {
      const [head = "", body = ""] = got.split("\r\n\r\n");
      resolve({ head: head.toLowerCase(), body });
    });
  });
}

/** A body that arrives in two parts, the way the audio proxy's does. */
const slowly = () => new ReadableStream<Uint8Array>({
  async pull(controller) {
    await Bun.sleep(20);
    controller.enqueue(new TextEncoder().encode("hello "));
    await Bun.sleep(20);
    controller.enqueue(new TextEncoder().encode("world"));
    controller.close();
  },
});

describe("alexa loopback audio", () => {
  test("sends a streamed body with its length, not chunked, so ffmpeg knows the file's size", async () => {
    const loopback = createLoopbackAudio();
    const ranges: (string | null)[] = [];
    const link = await loopback.link(async (range) => {
      ranges.push(range);
      return new Response(slowly(), { status: 206, headers: { "Content-Length": "11", "Content-Range": "bytes 0-10/11", "Content-Type": "audio/mp4" } });
    });
    expect(new URL(link.url).hostname).toBe("127.0.0.1");
    const { head, body } = await raw(link.url, "bytes=0-");
    expect(head).toStartWith("http/1.1 206");
    expect(head).toContain("content-length: 11");
    expect(head).toContain("content-range: bytes 0-10/11");
    expect(head).not.toContain("transfer-encoding");
    expect(body).toBe("hello world");
    expect(ranges).toEqual(["bytes=0-"]);
    link.close();
    expect((await raw(link.url)).head).toStartWith("http/1.1 404");
  });

  test("answers only its own unguessable paths, and a failed source with 502", async () => {
    const loopback = createLoopbackAudio();
    const good = await loopback.link(async () => new Response("ok", { headers: { "Content-Length": "2" } }));
    const bad = await loopback.link(async () => null);
    expect(good.url).not.toBe(bad.url);
    expect(new URL(good.url).pathname).toMatch(/^\/[0-9a-f]{32}$/);
    expect((await raw(`${new URL(good.url).origin}/nope`)).head).toStartWith("http/1.1 404");
    expect((await raw(bad.url)).head).toStartWith("http/1.1 502");
    expect((await raw(good.url)).body).toBe("ok");
  });
});
