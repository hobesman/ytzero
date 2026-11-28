import { describe, expect, test } from "bun:test";
import { authorizeHlsPlaylist, MEDIA_TICKET_RENEWAL_GRACE_MS, MEDIA_TICKET_TTL_MS, mediaTicketPath, MediaTicketStore, ticketAllowsPath, type MediaTicket } from "./mediaTickets";

const entry = { userId: 3, videoId: "video-1", sessionToken: "private-session", kind: "hls" as const };

describe("native playback capabilities", () => {
  test("live tickets authorize only their rolling playlist and opaque resources", () => {
    const ticket: MediaTicket = { ...entry, kind: "live-hls", expiresAt: 99999 };
    const base = "/api/videos/video-1/live-hls/";
    expect(mediaTicketPath(ticket)).toBe(`${base}index.m3u8`);
    for (const file of ["index.m3u8", "rv0123456789abcdef_42"]) {
      expect(ticketAllowsPath(ticket, base + file, "GET")).toBe(true);
      expect(ticketAllowsPath(ticket, base + file, "HEAD")).toBe(true);
      expect(ticketAllowsPath(ticket, base + file, "POST")).toBe(false);
    }
    for (const path of [base + "r0", base + "https://example.com", base + "../stream", "/api/videos/video-2/live-hls/index.m3u8", "/api/videos/video-1/direct-hls/index.m3u8"]) {
      expect(ticketAllowsPath(ticket, path, "GET")).toBe(false);
    }
    const playlist = authorizeHlsPlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nrv0123456789abcdef_42\n', `https://tv.example${base}index.m3u8`, ticket, "ticket");
    expect(playlist).toContain(`${base}rv0123456789abcdef_42?media_ticket=ticket`);
    expect(playlist).not.toContain(entry.sessionToken);
  });
  test("expires without authenticated renewal; renewal is bound to session, profile and video", () => {
    let now = 10;
    const store = new MediaTicketStore(() => now);
    const token = store.issue(entry);
    expect(token).not.toContain(entry.sessionToken);
    expect(store.renew(token, 4, entry.videoId, entry.sessionToken)).toBe(false);
    expect(store.renew(token, 3, "another-video", entry.sessionToken)).toBe(false);
    expect(store.renew(token, 3, entry.videoId, "other-session")).toBe(false);
    now += MEDIA_TICKET_TTL_MS - 1;
    expect(store.read(token)).not.toBeNull();
    expect(store.renew(token, 3, entry.videoId, entry.sessionToken)).toBe(true);
    now += MEDIA_TICKET_TTL_MS + MEDIA_TICKET_RENEWAL_GRACE_MS;
    expect(store.read(token)).toBeNull();
    expect(store.renew(token, 3, entry.videoId, entry.sessionToken)).toBe(false);
  });

  test("a lapsed ticket serves no media, but its owner may renew it within the grace", () => {
    let now = 0;
    const store = new MediaTicketStore(() => now);
    const token = store.issue(entry);
    now += MEDIA_TICKET_TTL_MS + 30 * 60_000;
    expect(store.read(token)).toBeNull();
    expect(store.renew(token, 4, entry.videoId, entry.sessionToken)).toBe(false);
    expect(store.renew(token, 3, entry.videoId, "other-session")).toBe(false);
    // A new ticket prunes only tickets past the grace.
    store.issue(entry);
    expect(store.renew(token, 3, entry.videoId, entry.sessionToken)).toBe(true);
    expect(store.read(token)).not.toBeNull();
    now += MEDIA_TICKET_TTL_MS + MEDIA_TICKET_RENEWAL_GRACE_MS;
    store.issue(entry);
    expect(store.owned(token, 3, entry.videoId, entry.sessionToken)).toBeNull();
    expect(store.renew(token, 3, entry.videoId, entry.sessionToken)).toBe(false);
  });

  test("caps memory and revokes tickets without serializing them", () => {
    const store = new MediaTicketStore(() => 0, 2);
    const first = store.issue(entry);
    const second = store.issue(entry);
    store.issue(entry);
    expect(store.read(first)).toBeNull();
    expect(store.read(second)).not.toBeNull();
    store.revoke(second);
    expect(store.read(second)).toBeNull();
    // A new process/restore has no capabilities from the previous instance.
    expect(new MediaTicketStore().read(first)).toBeNull();
  });

  test("permits only read access to the selected video and media transport", () => {
    for (const path of ["index.m3u8", "video.m3u8", "audio.m3u8", "video.mp4", "audio.mp4", "seg00002.ts"]) {
      expect(ticketAllowsPath(entry, `/api/videos/video-1/hls/${path}`, "GET")).toBe(true);
    }
    for (const path of ["/api/feed", "/api/videos/video-2/hls/index.m3u8", "/api/videos/video-1/stream", "/api/videos/video-1/file", "/api/videos/video-1/hls/../stream", "/api/videos/video-1/hls/subdir/index.m3u8"]) {
      expect(ticketAllowsPath(entry, path, "GET")).toBe(false);
    }
    expect(ticketAllowsPath(entry, "/api/videos/video-1/hls/index.m3u8", "POST")).toBe(false);
    expect(ticketAllowsPath({ ...entry, kind: "file" }, "/api/videos/video-1/stream", "HEAD")).toBe(true);
  });

  test("a Fast start stopgap ticket reads only that video's stopgap stream", () => {
    const ticket: MediaTicket = { ...entry, kind: "bridge", expiresAt: 99999 };
    expect(mediaTicketPath(ticket)).toBe("/api/videos/video-1/bridge-stream");
    for (const method of ["GET", "HEAD"]) expect(ticketAllowsPath(ticket, "/api/videos/video-1/bridge-stream", method)).toBe(true);
    expect(ticketAllowsPath(ticket, "/api/videos/video-1/bridge-stream", "POST")).toBe(false);
    for (const path of ["/api/videos/video-2/bridge-stream", "/api/videos/video-1/direct-stream", "/api/videos/video-1/direct-hls/index.m3u8", "/api/videos/video-1/stream"]) {
      expect(ticketAllowsPath(ticket, path, "GET")).toBe(false);
    }
    expect(ticketAllowsPath(entry, "/api/videos/video-1/bridge-stream", "GET")).toBe(false);
  });

  test("authorizes nested playlists, initialization ranges and segments without forwarding the API bearer", () => {
    const ticket: MediaTicket = { ...entry, expiresAt: 99999 };
    const source = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8?v=g1"\n#EXT-X-MAP:URI="video.mp4?v=g1",BYTERANGE="100@0"\nvideo.m3u8?v=g1\nseg00001.ts\n';
    const playlist = authorizeHlsPlaylist(source, "https://tv.example/api/videos/video-1/hls/index.m3u8", ticket, "short-ticket");
    expect(playlist).toContain('URI="/api/videos/video-1/hls/audio.m3u8?v=g1&media_ticket=short-ticket"');
    expect(playlist).toContain('URI="/api/videos/video-1/hls/video.mp4?v=g1&media_ticket=short-ticket",BYTERANGE="100@0"');
    expect(playlist).toContain('/api/videos/video-1/hls/seg00001.ts?media_ticket=short-ticket');
    expect(playlist).not.toContain(entry.sessionToken);
    expect(playlist).not.toContain("Authorization");
  });

  test("rejects external and out-of-scope playlist resources", () => {
    const ticket: MediaTicket = { ...entry, expiresAt: 99999 };
    for (const path of ["https://untrusted.example/seg00001.ts", "//untrusted.example/seg00001.ts", "/api/settings", "../../video-2/hls/seg00001.ts", "https://user:password@tv.example/api/videos/video-1/hls/video.mp4"]) {
      expect(() => authorizeHlsPlaylist(`#EXTM3U\n${path}`, "https://tv.example/api/videos/video-1/hls/index.m3u8", ticket, "ticket")).toThrow("unsupported media resource");
    }
  });

  test("direct HLS tickets authorize both renditions but cannot start downloads or use another transport", () => {
    const ticket: MediaTicket = { ...entry, kind: "direct-hls", expiresAt: 99999 };
    const base = "/api/videos/video-1/direct-hls/";
    expect(mediaTicketPath(ticket)).toBe(`${base}index.m3u8`);
    for (const file of ["index.m3u8", "video.m3u8", "audio.m3u8", "video.mp4", "audio.mp4"]) {
      for (const method of ["GET", "HEAD"]) expect(ticketAllowsPath(ticket, base + file, method)).toBe(true);
      expect(ticketAllowsPath(ticket, base + file, "POST")).toBe(false);
      expect(ticketAllowsPath(entry, base + file, "GET")).toBe(false);
    }
    for (const path of [base + "seg00001.ts", "/api/videos/video-1/hls/index.m3u8", "/api/videos/video-1/direct-stream", "/api/videos/video-1/download", "/api/videos/video-2/direct-hls/video.mp4"]) {
      expect(ticketAllowsPath(ticket, path, "GET")).toBe(false);
      expect(() => authorizeHlsPlaylist(`#EXTM3U\n${path}`, `https://tv.example${base}index.m3u8`, ticket, "short-ticket")).toThrow();
    }
    const source = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8?v=g1"\nvideo.m3u8?v=g1\n#EXT-X-MAP:URI="video.mp4?v=g1",BYTERANGE="100@0"\n#EXT-X-BYTERANGE:20@100\nvideo.mp4?v=g1\n';
    const playlist = authorizeHlsPlaylist(source, `https://tv.example${base}index.m3u8`, ticket, "short-ticket");
    expect(playlist).toContain(`URI="${base}audio.m3u8?v=g1&media_ticket=short-ticket"`);
    expect(playlist).toContain(`URI="${base}video.mp4?v=g1&media_ticket=short-ticket",BYTERANGE="100@0"`);
    expect(playlist).toContain(`#EXT-X-BYTERANGE:20@100\n${base}video.mp4?v=g1&media_ticket=short-ticket`);
    expect(playlist).not.toContain(entry.sessionToken);
  });
});
