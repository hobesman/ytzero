import { describe, expect, test } from "bun:test";
import { fetchSubtitleUpstream, firstSubtitleResponse, proxySubtitleResponse, safeSubtitleUpstreamUrl } from "./subtitleUpstream";

describe("subtitle upstream", () => {
  test("accepts only trusted HTTPS YouTube and Google Video hosts", () => {
    expect(safeSubtitleUpstreamUrl("https://www.youtube.com/api/timedtext?lang=en")).toContain("youtube.com");
    expect(safeSubtitleUpstreamUrl("https://r1.googlevideo.com/caption.vtt")).toContain("googlevideo.com");
    expect(safeSubtitleUpstreamUrl("http://www.youtube.com/api/timedtext")).toBeNull();
    expect(safeSubtitleUpstreamUrl("https://youtube.com.example.org/caption.vtt")).toBeNull();
    expect(safeSubtitleUpstreamUrl("https://user@example.youtube.com/caption.vtt")).toBeNull();
    expect(safeSubtitleUpstreamUrl("https://www.youtube.com:444/caption.vtt")).toBeNull();
  });

  test("revalidates redirects before fetching the next hop", async () => {
    const requested: string[] = [];
    const fetchMock = (async (input: URL | RequestInfo) => {
      const url = String(input);
      requested.push(url);
      return new Response(null, { status: 302, headers: { Location: "https://example.org/caption.vtt" } });
    }) as unknown as typeof fetch;
    const response = await fetchSubtitleUpstream(fetchMock, "https://www.youtube.com/api/timedtext?lang=en", {});
    expect(response).toBeNull();
    expect(requested).toEqual(["https://www.youtube.com/api/timedtext?lang=en"]);
  });

  test("follows a trusted redirect", async () => {
    let calls = 0;
    const fetchMock = (async () => {
      calls += 1;
      return calls === 1
        ? new Response(null, { status: 302, headers: { Location: "https://r1.googlevideo.com/caption.vtt" } })
        : new Response("WEBVTT\n");
    }) as unknown as typeof fetch;
    const response = await fetchSubtitleUpstream(fetchMock, "https://www.youtube.com/api/timedtext?lang=en", {});
    expect(await response?.text()).toBe("WEBVTT\n");
    expect(calls).toBe(2);
  });

  test("bounds the body and strips upstream headers", async () => {
    const tooLarge = proxySubtitleResponse(new Response("abcdef", { headers: { "Content-Length": "6" } }), 5);
    expect(tooLarge).toBeNull();
    const proxied = proxySubtitleResponse(new Response("WEBVTT\n", { headers: { "Set-Cookie": "secret=1" } }), 100);
    expect(proxied?.headers.get("content-type")).toBe("text/vtt; charset=utf-8");
    expect(proxied?.headers.get("set-cookie")).toBeNull();
    expect(await proxied?.text()).toBe("WEBVTT\n");
  });

  test("falls back to the next track when YouTube refuses one", async () => {
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(url);
      return url.includes("tlang") ? new Response("<html>Sorry...</html>", { status: 429 }) : new Response("WEBVTT", { status: 200 });
    }) as unknown as typeof fetch;
    const response = await firstSubtitleResponse(fetchImpl, [
      "https://www.youtube.com/api/timedtext?lang=en&tlang=en",
      "https://www.youtube.com/api/timedtext?lang=en",
    ], {});
    expect(await response?.text()).toBe("WEBVTT");
    expect(asked).toHaveLength(2);
    expect(await firstSubtitleResponse(fetchImpl, ["https://www.youtube.com/api/timedtext?tlang=de"], {})).toBeNull();
  });
});
