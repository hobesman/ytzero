import { describe, expect, test } from "bun:test";
import { createDownloadVideoDirectStreaming, parseDirectStreamQuality } from "./downloadVideoDirectStreaming";

function concat(...parts: Uint8Array<ArrayBufferLike>[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}

function uint32(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function box(type: string, payload: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
  return concat(uint32(8 + payload.byteLength), Uint8Array.from([...type].map((c) => c.charCodeAt(0))), payload);
}

/** A two-fragment fMP4 with a sidx index, 6 s per fragment. */
function media(): Uint8Array<ArrayBuffer> {
  const lengths = [2_000, 2_000];
  const ftyp = box("ftyp", concat(Uint8Array.from([..."dash"].map((c) => c.charCodeAt(0))), uint32(0), Uint8Array.from([..."iso6"].map((c) => c.charCodeAt(0)))));
  const moov = box("moov", new Uint8Array(16));
  const sidx = box("sidx", concat(
    Uint8Array.of(0, 0, 0, 0), uint32(1), uint32(1_000), uint32(0), uint32(0), Uint8Array.of(0, 0, 0, lengths.length),
    ...lengths.map((length) => concat(uint32(length), uint32(6_000), uint32(0x90000000))),
  ));
  return concat(ftyp, moov, sidx, new Uint8Array(lengths[0] + lengths[1]).fill(7));
}

function ranged(bytes: Uint8Array, rangeValue: string | null): Response {
  const match = rangeValue?.match(/^bytes=(\d+)-(\d+)$/);
  if (!match) return new Response(null, { status: 400 });
  const start = Number(match[1]);
  const end = Math.min(Number(match[2]), bytes.byteLength - 1);
  const body = bytes.slice(start, end + 1);
  return new Response(body, { status: 206, headers: {
    "Content-Length": String(body.byteLength),
    "Content-Range": `bytes ${start}-${end}/${bytes.byteLength}`,
  } });
}

const expires = 9_999_999_999;
function videoFormat(id: string, height: number, vcodec = "avc1.640028") {
  return {
    format_id: id, url: `https://r1.googlevideo.com/video-${id}?expire=${expires}`, ext: vcodec.startsWith("avc1") ? "mp4" : "webm",
    protocol: "https", vcodec, acodec: "none", width: Math.round(height * 16 / 9), height, fps: 30, vbr: height * 4,
  };
}
const audioFormat = {
  format_id: "140", url: `https://r1.googlevideo.com/audio-140?expire=${expires}`, ext: "m4a",
  protocol: "https", vcodec: "none", acodec: "mp4a.40.2", abr: 128, audio_channels: 2,
};

/** yt-dlp's answer: the selected pair plus the full format list, worst first. */
function selection(top: ReturnType<typeof videoFormat>) {
  return JSON.stringify({
    duration: 12,
    http_headers: { "User-Agent": "yt-dlp-test-agent" },
    requested_formats: [top, audioFormat],
    formats: [
      videoFormat("160", 144), videoFormat("134", 360), videoFormat("135", 480),
      videoFormat("247", 720, "vp09.00.31.08"), videoFormat("136", 720), videoFormat("137", 1080), audioFormat,
    ].filter((format) => !("height" in format) || format.height <= top.height),
  });
}

function harness(profileQuality = "best") {
  const selectors: string[] = [];
  const fetched: string[] = [];
  const bytes = media();
  const spawn = ((command: string[]) => {
    const selector = command[command.indexOf("-f") + 1];
    selectors.push(selector);
    const cap = Number(selector.match(/height<=(\d+)/)?.[1] ?? 1080);
    const top = cap >= 1080 ? videoFormat("137", 1080) : cap >= 720 ? videoFormat("136", 720) : cap >= 480 ? videoFormat("135", 480) : videoFormat("134", 360);
    return {
      stdout: new Response(selection(top)).body!, stderr: new Response("").body!,
      exited: Promise.resolve(0), kill: () => {},
    } as unknown as ReturnType<typeof Bun.spawn>;
  }) as unknown as typeof Bun.spawn;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    fetched.push(String(input));
    return ranged(bytes, new Headers(init?.headers).get("range"));
  }) as typeof fetch;
  const streaming = createDownloadVideoDirectStreaming({
    YTDLP: "yt-dlp",
    dlSettings: async () => ({ quality: profileQuality }),
    downloadCookiesConfigured: () => false,
    downloadCookiesFile: (userId: number) => `cookie-${userId}`,
    ytdlpStatus: async () => "2026.07.04",
    videoAvailable: async () => true,
    spawn,
    fetchImpl,
  });
  return { streaming, selectors, fetched };
}

function text(result: { kind: string; playlist?: string }): string {
  return result.kind === "playlist" ? result.playlist ?? "" : "";
}

describe("direct stream quality", () => {
  test("accepts auto and known heights only", () => {
    expect(parseDirectStreamQuality("auto")).toBe("auto");
    expect(parseDirectStreamQuality("720")).toBe("720");
    expect(parseDirectStreamQuality("0720")).toBe("720");
    expect(parseDirectStreamQuality("721")).toBe("");
    expect(parseDirectStreamQuality(720)).toBe("");
    expect(parseDirectStreamQuality(undefined)).toBe("");
    expect(parseDirectStreamQuality("720&v=x")).toBe("");
  });

  test("a fixed height caps the stream and stays on every child URI", async () => {
    const { streaming, selectors, fetched } = harness();
    const master = text(await streaming.getDirectHlsPlaylist(1, "fixed", "index.m3u8", undefined, null, "720"));
    expect(selectors).toEqual([expect.stringContaining("[height<=720]")]);
    expect(master).toContain("RESOLUTION=1280x720");
    const generation = master.match(/q=720&v=([a-f0-9]+)/)?.[1] ?? "";
    expect(generation).not.toBe("");
    const videoPlaylist = text(await streaming.getDirectHlsPlaylist(1, "fixed", "video.m3u8", undefined, generation, "720"));
    expect(videoPlaylist).toContain(`video.mp4?q=720&v=${generation}`);
    const resource = await streaming.getDirectHlsResource(1, "fixed", "video.mp4", "bytes=0-15", undefined, generation, "720");
    expect(resource.kind).toBe("response");
    expect(fetched.at(-1)).toContain("/video-136?");
    // The profile's own quality is a separate session.
    expect((await streaming.getDirectHlsResource(1, "fixed", "video.mp4", "bytes=0-15", undefined, generation)).kind).toBe("stale");
  });

  test("the profile's quality setting still caps a higher request", async () => {
    const { streaming, selectors } = harness("480");
    await streaming.getDirectHlsPlaylist(1, "capped", "index.m3u8", undefined, null, "1080");
    expect(selectors).toEqual([expect.stringContaining("[height<=480]")]);
  });

  test("auto offers lower H.264 renditions from one yt-dlp run", async () => {
    const { streaming, selectors, fetched } = harness();
    const master = text(await streaming.getDirectHlsPlaylist(1, "auto", "index.m3u8", undefined, null, "auto"));
    expect(selectors).toHaveLength(1);
    expect(master.match(/#EXT-X-STREAM-INF/g)).toHaveLength(4);
    expect(master.match(/#EXT-X-MEDIA:TYPE=AUDIO/g)).toHaveLength(1);
    const resolutions = [...master.matchAll(/RESOLUTION=\d+x(\d+)/g)].map((match) => Number(match[1]));
    expect(resolutions).toEqual([1080, 720, 480, 360]);
    expect(master).not.toContain("vp09");
    // The highest rendition is the profile's own stream; the others carry their height.
    expect(master).toMatch(/\/video\.m3u8\?v=[a-f0-9]+\n/);
    const generation = master.match(/video\.m3u8\?q=480&v=([a-f0-9]+)/)?.[1] ?? "";
    expect(generation).not.toBe("");
    const videoPlaylist = text(await streaming.getDirectHlsPlaylist(1, "auto", "video.m3u8", undefined, generation, "480"));
    expect(videoPlaylist).toContain("#EXT-X-BYTERANGE");
    expect((await streaming.getDirectHlsResource(1, "auto", "video.mp4", "bytes=0-15", undefined, generation, "480")).kind).toBe("response");
    expect(fetched.at(-1)).toContain("/video-135?");
    expect(selectors).toHaveLength(1);
  });

  test("auto stays a single rendition when nothing lower is offered", async () => {
    const { streaming } = harness("360");
    const master = text(await streaming.getDirectHlsPlaylist(1, "low", "index.m3u8", undefined, null, "auto"));
    expect(master.match(/#EXT-X-STREAM-INF/g)).toHaveLength(1);
  });

  test("invalidating a video drops every quality's session", async () => {
    const { streaming, selectors } = harness();
    await streaming.getDirectHlsPlaylist(1, "drop", "index.m3u8", undefined, null, "720");
    streaming.invalidateDirectHlsSources(1);
    await streaming.getDirectHlsPlaylist(1, "drop", "index.m3u8", undefined, null, "720");
    expect(selectors).toHaveLength(2);
  });
});
