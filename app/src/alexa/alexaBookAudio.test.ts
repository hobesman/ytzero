import { describe, expect, test } from "bun:test";
import {
  alexaBookAudioLink, alexaBookCoverLink, BOOK_AUDIO_PATH, bookStreamArgs, bookStreamResponse, verifyAlexaBookAudioLink, verifyAlexaBookCoverLink, type SpawnFfmpeg,
} from "./alexaBookAudio";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-27T12:00:00Z");

describe("book audio links", () => {
  test("are signed for the book, the file and the profile; the start is free", () => {
    const link = new URL(alexaBookAudioLink("https://yt.example.com", SECRET, "li_abc", 2, 7, 1234.5678, NOW));
    expect(link.pathname).toBe("/alexa/book-audio/li_abc/2");
    expect(link.searchParams.get("t")).toBe("1234.568");
    expect(verifyAlexaBookAudioLink(SECRET, "li_abc", 2, link.searchParams, NOW)).toBe(7);
    link.searchParams.set("t", "99");
    expect(verifyAlexaBookAudioLink(SECRET, "li_abc", 2, link.searchParams, NOW)).toBe(7);
    expect(verifyAlexaBookAudioLink(SECRET, "li_abc", 3, link.searchParams, NOW)).toBeNull();
    expect(verifyAlexaBookAudioLink(SECRET, "li_other", 2, link.searchParams, NOW)).toBeNull();
    expect(verifyAlexaBookAudioLink(SECRET, "li_abc", 2, link.searchParams, NOW + 25 * 3600_000)).toBeNull();
    expect(link.href.match(BOOK_AUDIO_PATH)?.slice(1)).toEqual(["li_abc", "2"]);
  });

  test("cover links don't expire but can't be moved to another book", () => {
    const link = new URL(alexaBookCoverLink("https://yt.example.com", SECRET, "li_abc"));
    expect(verifyAlexaBookCoverLink(SECRET, "li_abc", link.searchParams)).toBe(true);
    expect(verifyAlexaBookCoverLink(SECRET, "li_xyz", link.searchParams)).toBe(false);
  });
});

describe("the stream", () => {
  const source = { url: "http://abs/api/items/li_abc/file/111", headers: { Authorization: "Bearer k" } };

  test("AAC is copied; anything else is converted to AAC; both start where asked and write fragmented MP4", () => {
    const copied = bookStreamArgs(source, "aac", 18_123.4);
    expect(copied.slice(copied.indexOf("-ss"), copied.indexOf("-ss") + 4)).toEqual(["-ss", "18123.4", "-i", source.url]);
    expect(copied).toContain("copy");
    expect(copied[copied.indexOf("-headers") + 1]).toBe("Authorization: Bearer k\r\n");
    const converted = bookStreamArgs(source, "mp3", 0);
    expect(converted).not.toContain("-ss");
    expect(converted.slice(converted.indexOf("-c:a"), converted.indexOf("-c:a") + 2)).toEqual(["-c:a", "aac"]);
    expect(converted.slice(converted.indexOf("-f"), converted.indexOf("-f") + 2)).toEqual(["-f", "mp4"]);
  });

  const fake = (chunks: string[], stderr = ""): SpawnFfmpeg & { killed: boolean } => {
    const spawn = ((_args: string[]) => ({
      stdout: new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } }),
      stderr: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(stderr)); controller.close(); } }),
      kill: () => { spawn.killed = true; },
      exited: Promise.resolve(chunks.length ? 0 : 1),
    })) as SpawnFfmpeg & { killed: boolean };
    spawn.killed = false;
    return spawn;
  };

  test("answers 200 with ffmpeg's output", async () => {
    const { response, error } = await bookStreamResponse(source, "aac", 10, undefined, fake(["ftyp", "moof"]));
    expect(error).toBeUndefined();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mp4");
    expect(await response.text()).toBe("ftypmoof");
  });

  test("says the stream ended when the whole file went out", async () => {
    const closes: { ended: boolean; bytes: number }[] = [];
    const { response } = await bookStreamResponse(source, "aac", 10, undefined, fake(["ftyp", "moof"]), (outcome) => closes.push(outcome));
    await response.text();
    expect(closes).toEqual([{ ended: true, bytes: 8 }]);
  });

  test("says the stream was dropped when the listener lets go first, once", async () => {
    const closes: { ended: boolean; bytes: number }[] = [];
    const spawn = fake(["ftyp", "moof", "mdat"]);
    const { response } = await bookStreamResponse(source, "aac", 10, undefined, spawn, (outcome) => closes.push(outcome));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(spawn.killed).toBe(true);
    expect(closes).toEqual([{ ended: false, bytes: 4 }]);
  });

  test("an aborted request is a drop", async () => {
    const closes: { ended: boolean }[] = [];
    const controller = new AbortController();
    await bookStreamResponse(source, "aac", 10, controller.signal, fake(["ftyp", "moof"]), (outcome) => closes.push(outcome));
    controller.abort();
    expect(closes.map((item) => item.ended)).toEqual([false]);
  });

  test("a stream that never started reports no close", async () => {
    const closes: unknown[] = [];
    await bookStreamResponse(source, "aac", 10, undefined, fake([]), (outcome) => closes.push(outcome));
    expect(closes).toEqual([]);
  });

  test("answers 502 with ffmpeg's first complaint when it produces nothing", async () => {
    const { response, error } = await bookStreamResponse(source, "aac", 10, undefined, fake([], "Server returned 401 Unauthorized\nmore"));
    expect(response.status).toBe(502);
    expect(error).toBe("Server returned 401 Unauthorized");
  });
});
