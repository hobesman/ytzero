import { describe, expect, test } from "bun:test";
import { publicBaseUrl } from "./publicBaseUrl";
import { buildPublicSharePreview, escapeHtml, injectPublicSharePreview, loadPublicSharePreview, publicSharePreviewTags } from "./publicSharePreview";
import type { PublicShareRow, PublicShareVideo, ResolvedPublicShare } from "./publicSharing";

const TOKEN = "a".repeat(43);
const BASE = "https://yt.example.com";
const SHELL = "<!doctype html><html><head><meta charset=\"UTF-8\" />\n    <title>YT Zero</title>\n  </head><body></body></html>";

function share(overrides: Partial<PublicShareRow> = {}): PublicShareRow {
  return {
    id: "share-1", token: TOKEN, owner_user_id: 1, resource_type: "video", resource_id: "dQw4w9WgXcQ",
    allow_local_media: 0, allow_server_stream: 0, max_plays: 10, play_count: 0, expires_at: null,
    created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z", ...overrides,
  };
}

function video(overrides: Partial<PublicShareVideo> = {}): PublicShareVideo {
  return {
    video_id: "dQw4w9WgXcQ", channel_id: "UC1", title: "A video", description: "", thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    published_at: null, published_at_approximate: 0, live_status: "none", duration: null, views: null, likes: null,
    channel_title: "A channel", chapters_json: null, ...overrides,
  };
}

function resolved(row: PublicShareRow, title = "Shared resource"): ResolvedPublicShare {
  return { share: row, resource: { title, video_count: 3 } };
}

const base = { baseUrl: BASE, siteName: "YT Zero", active: true };

describe("public share preview", () => {
  test("a shared video previews its title, channel and the share's thumbnail route", () => {
    const preview = buildPublicSharePreview({ ...base, resolved: resolved(share(), "A video"), video: video() });
    expect(preview).toEqual({
      siteName: "YT Zero",
      title: "A video",
      url: `${BASE}/share/${TOKEN}`,
      image: `${BASE}/share/${TOKEN}/thumbnail/dQw4w9WgXcQ`,
      type: "video.other",
      description: "A channel",
    });
  });

  test("a playlist previews its own title with its first video's thumbnail", () => {
    const row = share({ resource_type: "user_playlist", resource_id: "7" });
    const preview = buildPublicSharePreview({ ...base, resolved: resolved(row, "Road trip"), video: video() });
    expect(preview).toMatchObject({ title: "Road trip", type: "website", description: null, image: `${BASE}/share/${TOKEN}/thumbnail/dQw4w9WgXcQ` });
  });

  test("a video inside a playlist previews that video at its own address", () => {
    const row = share({ resource_type: "followed_playlist", resource_id: "PL1" });
    const preview = buildPublicSharePreview({ ...base, resolved: resolved(row, "Road trip"), video: video({ title: "Track two" }), pathVideoId: "dQw4w9WgXcQ" });
    expect(preview).toMatchObject({ title: "Track two", type: "video.other", url: `${BASE}/share/${TOKEN}/video/dQw4w9WgXcQ` });
  });

  test("a video without a stored thumbnail falls back to YouTube's", () => {
    const preview = buildPublicSharePreview({ ...base, resolved: resolved(share()), video: video({ thumbnail: "" }) });
    expect(preview.image).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(buildPublicSharePreview({ ...base, resolved: resolved(share()), video: video({ video_id: "not/an/id", thumbnail: "" }) }).image).toBeNull();
  });

  test("an inactive link previews only the site", async () => {
    let looked = false;
    const lookups = { videoIds: async () => { looked = true; return ["dQw4w9WgXcQ"]; }, video: async () => { looked = true; return video(); } };
    const preview = await loadPublicSharePreview({ ...base, active: false, resolved: resolved(share(), "Secret title") }, lookups);
    expect(preview).toEqual({ siteName: "YT Zero", title: "YT Zero", url: `${BASE}/share/${TOKEN}`, image: null, type: "website", description: null });
    expect(looked).toBe(false);
    const html = injectPublicSharePreview(SHELL, preview);
    expect(html).not.toContain("Secret title");
    expect(html).not.toContain("og:image");
    expect(html).toContain(`<meta name="twitter:card" content="summary" />`);
  });

  test("the loader picks the shared video or the playlist's first", async () => {
    const asked: string[] = [];
    const lookups = { videoIds: async () => ["first0video"], video: async (id: string) => { asked.push(id); return video({ video_id: id, title: id }); } };
    await loadPublicSharePreview({ ...base, resolved: resolved(share()) }, lookups);
    await loadPublicSharePreview({ ...base, resolved: resolved(share({ resource_type: "user_playlist", resource_id: "7" })) }, lookups);
    await loadPublicSharePreview({ ...base, resolved: resolved(share({ resource_type: "user_playlist", resource_id: "7" })), pathVideoId: "picked0vid0" }, lookups);
    expect(asked).toEqual(["dQw4w9WgXcQ", "first0video", "picked0vid0"]);
  });

  test("every value is HTML-escaped", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;");
    const preview = buildPublicSharePreview({ ...base, resolved: resolved(share()), video: video({ title: `"/><script>alert(1)</script>`, channel_title: "A & B" }) });
    const tags = publicSharePreviewTags(preview);
    expect(tags).not.toContain("<script>");
    expect(tags).toContain(`<title>&quot;/&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>`);
    expect(tags).toContain(`<meta property="og:description" content="A &amp; B" />`);
  });

  test("the tags replace the shell's title inside the head", () => {
    const preview = buildPublicSharePreview({ ...base, resolved: resolved(share()), video: video({ title: "Cost $& more" }) });
    const html = injectPublicSharePreview(SHELL, preview);
    expect(html).not.toContain("<title>YT Zero</title>");
    expect(html).toContain("<title>Cost $&amp; more</title>");
    const head = html.slice(0, html.indexOf("</head>"));
    for (const tag of ["og:title", "og:image", "og:url", "og:site_name", "og:type", "twitter:card"]) expect(head).toContain(tag);
    expect(head).toContain(`<meta name="twitter:card" content="summary_large_image" />`);
    expect(injectPublicSharePreview("<html><head></head></html>", preview)).toMatch(/<title>.*<\/title>[\s\S]*<\/head>/);
  });
});

describe("public base URL", () => {
  test("uses APP_URL with its path prefix, else the request origin", () => {
    expect(publicBaseUrl("http://10.0.0.2:3000/share/x", "https://yt.example.com/zero/")).toBe("https://yt.example.com/zero");
    expect(publicBaseUrl("http://10.0.0.2:3000/share/x", "https://yt.example.com")).toBe("https://yt.example.com");
    expect(publicBaseUrl("http://10.0.0.2:3000/share/x", "")).toBe("http://10.0.0.2:3000");
    expect(publicBaseUrl("http://10.0.0.2:3000/share/x", "not a url")).toBe("http://10.0.0.2:3000");
  });
});
