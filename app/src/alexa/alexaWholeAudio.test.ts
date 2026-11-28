import { describe, expect, test } from "bun:test";
import { wholeAudioResponse } from "./alexaWholeAudio";

const FILE = Uint8Array.from({ length: 25 }, (_, index) => index);

/** The shared proxy: at most `piece` bytes per answer, as a 206. */
function proxy(piece: number, requested: string[], failFrom?: number) {
  return async (range: string): Promise<Response | null> => {
    requested.push(range);
    const start = Number(range.match(/^bytes=(\d+)-$/)![1]);
    if (failFrom != null && start >= failFrom) return new Response("gone", { status: 502 });
    const end = Math.min(FILE.length, start + piece) - 1;
    return new Response(FILE.slice(start, end + 1), {
      status: 206,
      headers: { "Content-Type": "audio/mp4", "Content-Range": `bytes ${start}-${end}/${FILE.length}` },
    });
  };
}

describe("alexa whole audio", () => {
  test("answers 200 with the full length, reading every piece in turn", async () => {
    const requested: string[] = [];
    const response = (await wholeAudioResponse(proxy(10, requested)))!;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("25");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-type")).toBe("audio/mp4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(FILE);
    expect(requested).toEqual(["bytes=0-", "bytes=10-", "bytes=20-"]);
  });

  test("a file that fits in one piece, and a failed first piece, pass through", async () => {
    const requested: string[] = [];
    const whole = (await wholeAudioResponse(proxy(100, requested)))!;
    expect(whole.status).toBe(200);
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(FILE);
    expect((await wholeAudioResponse(async () => new Response("no", { status: 502 })))?.status).toBe(502);
    expect(await wholeAudioResponse(async () => null)).toBeNull();
  });

  test("from part way in, answers 206 with the rest of the file", async () => {
    const requested: string[] = [];
    const response = (await wholeAudioResponse(proxy(10, requested), 7))!;
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 7-24/25");
    expect(response.headers.get("content-length")).toBe("18");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(FILE.slice(7));
    expect(requested).toEqual(["bytes=7-", "bytes=17-"]);
  });

  test("a later piece that fails ends the stream with an error", async () => {
    const response = (await wholeAudioResponse(proxy(10, [], 10)))!;
    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).rejects.toThrow();
  });
});
