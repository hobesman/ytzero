import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_PUBLIC_SHARING_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("public sharing suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/publicSharing.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-public-sharing-"));
  process.env.DB_PATH = resolve(root, "db", "sharing.db");
  process.env.DOWNLOADS_DIR = resolve(root, "downloads");
  process.env.TUBE_ARCHIVIST_CONFIG_DIR = resolve(root, "tubearchivist");
  const uiDir = resolve(root, "ui");
  mkdirSync(uiDir, { recursive: true });
  writeFileSync(resolve(uiDir, "index.html"), "<!doctype html><title>Public share</title>");

  const { db } = await import("./db");
  const { ensureAccessControl } = await import("./accessControl");
  const sharing = await import("./publicSharing");
  const { createPublicShareRouter, PublicShareMediaLimiter, PublicShareRateLimiter } = await import("./routes/publicShareRoutes");

  await ensureAccessControl();

  db.prepare("INSERT INTO channels(channel_id,title,url,thumbnail) VALUES('UCshare','Public creator','https://youtube.com/channel/UCshare','https://yt3.ggpht.com/public-avatar')").run();
  db.prepare(`INSERT INTO videos(video_id,channel_id,title,description,thumbnail,published_at,duration,views,likes,is_private,is_unavailable,members_only)
    VALUES('public001','UCshare','Public video','Safe description','https://i.ytimg.com/vi/public001/hqdefault.jpg','2026-09-01T10:00:00.000Z','12:34',42,3,0,0,0)`).run();
  db.prepare("INSERT INTO videos(video_id,channel_id,title,is_private) VALUES('private001','UCshare','Private video',1)").run();
  db.prepare("INSERT INTO videos(video_id,channel_id,title,members_only) VALUES('members001','UCshare','Members video',1)").run();
  db.prepare("INSERT INTO user_channels(user_id,channel_id,followed) VALUES(1,'UCshare',1)").run();

  afterAll(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe("public share capability lifecycle", () => {
    test("starts disabled and generates independent 256-bit base64url tokens", async () => {
      expect(await sharing.publicSharingEnabled()).toBe(false);
      const tokens = new Set(Array.from({ length: 128 }, () => sharing.createPublicShareToken()));
      expect(tokens.size).toBe(128);
      for (const token of tokens) expect(token).toMatch(sharing.PUBLIC_SHARE_TOKEN_PATTERN);
    });

    test("validates ownership and dynamically filters private content", async () => {
      await sharing.setPublicSharingEnabled(true);
      const share = await sharing.createPublicShare(1, "video", "public001");
      expect((await sharing.createPublicShare(1, "video", "public001")).id).toBe(share.id);
      expect(await sharing.resolvePublicShare(share.token)).not.toBeNull();
      await expect(sharing.createPublicShare(1, "video", "private001")).rejects.toMatchObject({ code: "public_share_resource_unavailable" });
      await expect(sharing.createPublicShare(1, "video", "members001")).rejects.toMatchObject({ code: "public_share_resource_unavailable" });

      db.prepare("UPDATE videos SET is_private=1 WHERE video_id='public001'").run();
      expect(await sharing.resolvePublicShare(share.token)).toBeNull();
      db.prepare("UPDATE videos SET is_private=0 WHERE video_id='public001'").run();
      expect(await sharing.resolvePublicShare(share.token)).not.toBeNull();
    });

    test("suspends and restores a non-admin link with permission and ownership", async () => {
      const userId = Number(db.prepare("INSERT INTO users(name) VALUES('Publisher')").run().lastInsertRowid);
      db.prepare("INSERT INTO user_channels(user_id,channel_id,followed) VALUES(?,'UCshare',1)").run(userId);
      await expect(sharing.createPublicShare(userId, "video", "public001")).rejects.toMatchObject({ code: "public_sharing_permission_denied" });
      db.prepare("INSERT INTO profile_permission_overrides(user_id,permission,allowed) VALUES(?,'public_sharing',1)").run(userId);
      const share = await sharing.createPublicShare(userId, "video", "public001");
      expect(await sharing.resolvePublicShare(share.token)).not.toBeNull();

      db.prepare("DELETE FROM profile_permission_overrides WHERE user_id=? AND permission='public_sharing'").run(userId);
      expect(await sharing.resolvePublicShare(share.token)).toBeNull();
      db.prepare("INSERT INTO profile_permission_overrides(user_id,permission,allowed) VALUES(?,'public_sharing',1)").run(userId);
      expect(await sharing.resolvePublicShare(share.token)).not.toBeNull();

      db.prepare("DELETE FROM user_channels WHERE user_id=? AND channel_id='UCshare'").run(userId);
      expect(await sharing.resolvePublicShare(share.token)).toBeNull();
      db.prepare("INSERT INTO user_channels(user_id,channel_id,followed) VALUES(?,'UCshare',1)").run(userId);
      expect(await sharing.resolvePublicShare(share.token)).not.toBeNull();
    });

    test("keeps playlists live and filters disallowed members", async () => {
      const playlistId = Number(db.prepare("INSERT INTO user_playlists(name,user_id) VALUES('Shared list',1)").run().lastInsertRowid);
      db.prepare("INSERT INTO user_playlist_videos(playlist_id,video_id,position) VALUES(?,'public001',0),(?,'private001',1)").run(playlistId, playlistId);
      const personal = await sharing.createPublicShare(1, "user_playlist", String(playlistId));
      expect(await sharing.publicShareVideoIds(personal, 0)).toEqual(["public001"]);
      db.prepare("DELETE FROM user_playlist_videos WHERE playlist_id=? AND video_id='public001'").run(playlistId);
      expect(await sharing.publicShareVideoIds(personal, 0)).toEqual([]);
      db.prepare("INSERT INTO user_playlist_videos(playlist_id,video_id,position) VALUES(?,'public001',0)").run(playlistId);
      expect(await sharing.publicShareVideoIds(personal, 0)).toEqual(["public001"]);

      db.prepare("DELETE FROM user_playlists WHERE id=?").run(playlistId);
      expect(await sharing.resolvePublicShare(personal.token)).toBeNull();
      expect(await sharing.managedPublicShare(personal.id)).toBeNull();

      db.prepare("INSERT INTO channel_playlists(playlist_id,channel_id,title) VALUES('PLshare','UCshare','Followed list')").run();
      db.prepare("INSERT INTO channel_playlist_videos(playlist_id,video_id,position) VALUES('PLshare','public001',0)").run();
      db.prepare("INSERT INTO user_followed_playlists(user_id,playlist_id) VALUES(1,'PLshare')").run();
      const followed = await sharing.createPublicShare(1, "followed_playlist", "PLshare");
      expect(await sharing.resolvePublicShare(followed.token)).not.toBeNull();
      db.prepare("DELETE FROM user_followed_playlists WHERE user_id=1 AND playlist_id='PLshare'").run();
      expect(await sharing.resolvePublicShare(followed.token)).toBeNull();
      db.prepare("INSERT INTO user_followed_playlists(user_id,playlist_id) VALUES(1,'PLshare')").run();
      expect(await sharing.resolvePublicShare(followed.token)).not.toBeNull();
    });

    test("rotates when local media is enabled and revokes permanently", async () => {
      const current = await sharing.createPublicShare(1, "video", "public001");
      const enabled = await sharing.updatePublicShare(current.id, { allowLocalMedia: true });
      expect(enabled.rotated).toBe(true);
      expect(enabled.share?.token).not.toBe(current.token);
      expect(await sharing.resolvePublicShare(current.token)).toBeNull();
      expect(await sharing.resolvePublicShare(enabled.share!.token)).not.toBeNull();
      const disabled = await sharing.updatePublicShare(current.id, { allowLocalMedia: false });
      expect(disabled.rotated).toBe(false);
      expect(disabled.share?.token).toBe(enabled.share?.token);
      expect(await sharing.deletePublicShare(current.id)).toBe(true);
      expect(await sharing.resolvePublicShare(enabled.share!.token)).toBeNull();
    });
  });

  describe("public route security", () => {
    test("returns only the allowlisted projection with hardening headers", async () => {
      const share = await sharing.createPublicShare(1, "video", "public001");
      const router = createPublicShareRouter(uiDir);
      const response = await router.request(`http://localhost/${share.token}/data`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-robots-tag")).toContain("noindex");
      expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
      const body = await response.json() as Record<string, unknown>;
      expect(body.brand).toEqual({ name: "YT Zero", icon: "/favicon.svg", color: "#0a5fff" });
      expect(JSON.stringify(body)).not.toContain("owner_user_id");
      expect(JSON.stringify(body)).not.toContain("Publisher");
      expect((body.creators as Array<{ avatar: string }>)[0]?.avatar).toBe(`/share/${share.token}/avatar/public001/UCshare`);
      expect(JSON.stringify(body)).not.toContain("https://yt3.ggpht.com/public-avatar");
      expect(body).not.toHaveProperty("comments");
      expect(body).not.toHaveProperty("transcript");

      await sharing.setPublicSharingEnabled(false);
      const suspended = await router.request(`http://localhost/${share.token}/data`);
      const invalid = await router.request("http://localhost/not-a-valid-token/data");
      expect(suspended.status).toBe(404);
      expect(await suspended.text()).toBe(await invalid.text());
      await sharing.setPublicSharingEnabled(true);
    });

    test("validates a video route before returning the public application shell", async () => {
      const share = await sharing.createPublicShare(1, "video", "public001");
      const router = createPublicShareRouter(uiDir);
      expect((await router.request(`http://localhost/${share.token}`)).status).toBe(200);
      expect((await router.request(`http://localhost/${share.token}/video/public001`)).status).toBe(200);
      expect((await router.request(`http://localhost/${share.token}/video/private001`)).status).toBe(404);
    });

    test("enforces the lightweight-request burst and refill", () => {
      let now = 0;
      const limiter = new PublicShareRateLimiter(() => now);
      for (let index = 0; index < 30; index++) expect(limiter.take("ip:token").allowed).toBe(true);
      expect(limiter.take("ip:token")).toMatchObject({ allowed: false, retryAfter: 1 });
      now += 500;
      expect(limiter.take("ip:token").allowed).toBe(true);
    });

    test("holds no more than four media leases per token", () => {
      const limiter = new PublicShareMediaLimiter();
      const leases = Array.from({ length: 4 }, () => limiter.acquire("token"));
      expect(leases.every(Boolean)).toBe(true);
      expect(limiter.acquire("token")).toBeNull();
      leases[0]?.();
      expect(limiter.acquire("token")).toBeFunction();
    });
  });

  const limits = await import("./publicShareLimits");
  describe("public share limits and server streaming", () => {
    let videoSeq = 0;
    const newVideo = () => {
      const id = `limits${String(++videoSeq).padStart(3, "0")}`;
      db.prepare("INSERT INTO videos(video_id,channel_id,title,live_status) VALUES(?,'UCshare',?,'none')").run(id, `Limits ${id}`);
      return id;
    };
    const visit = (router: ReturnType<typeof createPublicShareRouter>, path: string, visitor: string, userAgent = "test-agent") =>
      router.request(`http://localhost/${path}`, { headers: { "x-forwarded-for": visitor, "user-agent": userAgent } });

    const fakeStreaming = () => {
      const calls: string[] = [];
      const backend = {
        available: async () => { calls.push("available"); return true; },
        playlist: async (userId: number, videoId: string, file: string) => {
          calls.push(`playlist:${userId}:${videoId}:${file}`);
          return { kind: "playlist" as const, playlist: `#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="/api/videos/${videoId}/direct-hls/audio.m3u8?v=gen12345"\n/api/videos/${videoId}/direct-hls/video.m3u8?v=gen12345\n` };
        },
        resource: async (userId: number, videoId: string, file: string, range: string | null) => {
          calls.push(`resource:${userId}:${videoId}:${file}:${range}`);
          return { kind: "response" as const, response: new Response("bytes", { status: 206 }) };
        },
      };
      return { backend, calls };
    };

    test("new links default to 10 plays and a 2-day expiry, with streaming off", async () => {
      const before = Date.now();
      const share = await sharing.createPublicShare(1, "video", newVideo());
      expect(share.allow_server_stream).toBe(0);
      expect(share.max_plays).toBe(limits.PUBLIC_SHARE_DEFAULT_MAX_PLAYS);
      expect(limits.PUBLIC_SHARE_DEFAULT_MAX_PLAYS).toBe(10);
      expect(share.play_count).toBe(0);
      const expiresIn = Date.parse(share.expires_at!) - before;
      expect(expiresIn).toBeGreaterThanOrEqual(48 * 3_600_000 - 1_000);
      expect(expiresIn).toBeLessThanOrEqual(48 * 3_600_000 + 5_000);
    });

    test("counts a play once per visitor and video, not per request", async () => {
      const videoId = newVideo();
      const share = await sharing.createPublicShare(1, "video", videoId);
      await sharing.updatePublicShare(share.id, { maxPlays: 2 });
      const router = createPublicShareRouter(uiDir);
      for (let index = 0; index < 3; index++) expect((await visit(router, `${share.token}/data`, "198.51.100.1")).status).toBe(200);
      expect((await sharing.managedPublicShare(share.id))?.play_count).toBe(1);
      expect((await visit(router, `${share.token}/data`, "198.51.100.2")).status).toBe(200);
      expect((await sharing.managedPublicShare(share.id))?.play_count).toBe(2);

      const refused = await visit(router, `${share.token}/data`, "198.51.100.3");
      expect(refused.status).toBe(410);
      expect(await refused.json()).toEqual({ error: "expired", reason: "plays_exhausted" });
      expect((await sharing.managedPublicShare(share.id))?.play_count).toBe(2);
      // Visitors who already used a play keep working (reloads, seeking).
      expect((await visit(router, `${share.token}/data`, "198.51.100.1")).status).toBe(200);
      expect((await visit(router, `${share.token}/thumbnail/${videoId}`, "198.51.100.3")).status).toBe(410);
      // The page shell still loads so it can show the expired state.
      expect((await visit(router, share.token, "198.51.100.3")).status).toBe(200);

      const managed = await sharing.listManagedPublicShares(1, false, { resourceType: "video", resourceId: videoId });
      expect(await sharing.publicShareStatus(managed[0]!, true)).toMatchObject({ active: false, reason: "plays_exhausted" });

      await sharing.updatePublicShare(share.id, { resetPlays: true });
      expect((await sharing.managedPublicShare(share.id))?.play_count).toBe(0);
      expect((await visit(router, `${share.token}/data`, "198.51.100.3")).status).toBe(200);
      await sharing.updatePublicShare(share.id, { maxPlays: null });
      for (const visitor of ["203.0.113.1", "203.0.113.2", "203.0.113.3"]) {
        expect((await visit(router, `${share.token}/data`, visitor)).status).toBe(200);
      }
      expect((await sharing.managedPublicShare(share.id))?.max_plays).toBeNull();
    });

    test("expires by time for every visitor and media request", async () => {
      const videoId = newVideo();
      const share = await sharing.createPublicShare(1, "video", videoId);
      const updated = (await sharing.updatePublicShare(share.id, { allowLocalMedia: true })).share!;
      const router = createPublicShareRouter(uiDir);
      expect((await visit(router, `${updated.token}/data`, "192.0.2.1")).status).toBe(200);
      db.prepare("UPDATE public_share_limits SET expires_at=? WHERE share_id=?").run(new Date(Date.now() - 1_000).toISOString(), share.id);
      const expired = await visit(router, `${updated.token}/data`, "192.0.2.1");
      expect(expired.status).toBe(410);
      expect(await expired.json()).toEqual({ error: "expired", reason: "expired" });
      expect((await visit(router, `${updated.token}/media/${videoId}`, "192.0.2.1")).status).toBe(410);
      expect((await visit(router, updated.token, "192.0.2.1")).status).toBe(200);

      await sharing.updatePublicShare(share.id, { expiresInHours: 24 });
      expect((await visit(router, `${updated.token}/data`, "192.0.2.1")).status).toBe(200);
      await sharing.updatePublicShare(share.id, { expiresInHours: null });
      expect((await sharing.managedPublicShare(share.id))?.expires_at).toBeNull();
    });

    test("never reaches yt-dlp for anonymous visitors unless streaming is granted", async () => {
      const videoId = newVideo();
      const share = await sharing.createPublicShare(1, "video", videoId);
      const { backend, calls } = fakeStreaming();
      const router = createPublicShareRouter(uiDir, { streaming: backend });
      const data = await (await visit(router, `${share.token}/data`, "192.0.2.10")).json() as { playback: unknown };
      expect(data.playback).toEqual({ kind: "youtube", video_id: videoId });
      expect((await visit(router, `${share.token}/stream/${videoId}/index.m3u8`, "192.0.2.10")).status).toBe(404);
      expect((await visit(router, `${share.token}/stream/${videoId}/video.mp4?v=gen12345`, "192.0.2.10")).status).toBe(404);
      expect(calls).toEqual([]);
    });

    test("granting streaming rotates the link and streams through the owner's session", async () => {
      const videoId = newVideo();
      const share = await sharing.createPublicShare(1, "video", videoId);
      await sharing.updatePublicShare(share.id, { maxPlays: null, expiresInHours: null });
      const granted = await sharing.updatePublicShare(share.id, { allowServerStream: true });
      expect(granted.rotated).toBe(true);
      expect(granted.share?.token).not.toBe(share.token);
      expect(await sharing.resolvePublicShare(share.token)).toBeNull();
      // A grant on an unlimited link brings back the default limits.
      expect(granted.share?.max_plays).toBe(10);
      expect(granted.share?.expires_at).not.toBeNull();
      const token = granted.share!.token;

      const { backend, calls } = fakeStreaming();
      const router = createPublicShareRouter(uiDir, { streaming: backend });
      const data = await (await visit(router, `${token}/data`, "192.0.2.20")).json() as { playback: unknown };
      expect(data.playback).toEqual({ kind: "stream", url: `/share/${token}/stream/${videoId}/index.m3u8`, video_id: videoId });
      const playlist = await (await visit(router, `${token}/stream/${videoId}/index.m3u8`, "192.0.2.20")).text();
      expect(playlist).not.toContain("/api/");
      expect(playlist).toContain(`/share/${token}/stream/${videoId}/video.m3u8?v=gen12345`);
      expect(playlist).toContain(`/share/${token}/stream/${videoId}/audio.m3u8?v=gen12345`);
      const segment = await router.request(`http://localhost/${token}/stream/${videoId}/video.mp4?v=gen12345`, {
        headers: { "x-forwarded-for": "192.0.2.20", "user-agent": "test-agent", range: "bytes=0-99" },
      });
      expect(segment.status).toBe(206);
      expect(calls).toContain(`playlist:1:${videoId}:index.m3u8`);
      expect(calls).toContain(`resource:1:${videoId}:video.mp4:bytes=0-99`);
      expect((await visit(router, `${token}/stream/${videoId}/other.ts`, "192.0.2.20")).status).toBe(404);
      // Segment requests do not use up more plays.
      expect((await sharing.managedPublicShare(share.id))?.play_count).toBe(1);

      const revoked = await sharing.updatePublicShare(share.id, { allowServerStream: false });
      expect(revoked.rotated).toBe(false);
      expect((await visit(router, `${token}/stream/${videoId}/index.m3u8`, "192.0.2.20")).status).toBe(404);
    });

    test("validates management updates", () => {
      expect(limits.parsePublicShareUpdate({ allow_server_stream: true, max_plays: 5, expires_in_hours: null, reset_plays: true }))
        .toEqual({ ok: true, update: { allowLocalMedia: undefined, allowServerStream: true, maxPlays: 5, expiresInHours: null, resetPlays: true } });
      expect(limits.parsePublicShareUpdate({}).ok).toBe(false);
      expect(limits.parsePublicShareUpdate({ max_plays: 0 }).ok).toBe(false);
      expect(limits.parsePublicShareUpdate({ max_plays: 1.5 }).ok).toBe(false);
      expect(limits.parsePublicShareUpdate({ expires_in_hours: "48" }).ok).toBe(false);
      expect(limits.parsePublicShareUpdate({ allow_server_stream: "yes" }).ok).toBe(false);
      expect(limits.publicShareVisitorKey("share", "198.51.100.1", "agent")).not.toContain("198.51.100.1");
    });
  });
}
