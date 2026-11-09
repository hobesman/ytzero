import { strict as assert } from "node:assert";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";

const { api } = await import("../src/routes");
const { createSession, destroySession } = await import("../src/auth");
const { database } = await import("../src/database");
const { setSetting, setUserSetting } = await import("../src/db");
const { mediaTickets, serveMediaTicket } = await import("../src/nativePlayback");

await setSetting("auth_method", "shared");
await database.prepare("INSERT INTO channels(channel_id,title,url) VALUES('UC-native','Native tests','https://example.test')").run();
await database.prepare("INSERT INTO videos(video_id,channel_id,title,description,thumbnail) VALUES('native-test','UC-native','Native test','','')").run();
const mediaDir = Bun.env.DOWNLOADS_DIR!;
mkdirSync(mediaDir, { recursive: true });
const mediaPath = join(mediaDir, "native-test.mp4");
await Bun.write(mediaPath, "0123456789abcdef");
await database.prepare("INSERT INTO downloads(video_id,status,source,path,size_bytes,requested_by_user_id) VALUES('native-test','done','manual',?,16,1)").run(mediaPath);
await database.prepare("INSERT INTO download_owners(user_id,video_id,source) VALUES(1,'native-test','manual')").run();

const token = await createSession(1, "account");
const app = new Hono().route("/api", api);
const request = (path: string, method = "GET", body?: unknown, session = token) => app.request(`http://localhost/api${path}`, {
  method,
  headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session}` } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
const issue = async (session = token) => {
  let response = await request("/videos/native-test/playback-ticket", "POST", {}, session);
  const deadline = Date.now() + 5000;
  while (response.status === 202 && Date.now() < deadline) {
    assert.deepEqual(await response.json(), { preparing: true });
    assert.equal(response.headers.get("retry-after"), "2");
    await new Promise((resolve) => setTimeout(resolve, 100));
    response = await request("/videos/native-test/playback-ticket", "POST", {}, session);
  }
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const value = await response.json() as { ticket: string; url: string; expires_in: number; content_type: string };
  assert.equal(value.content_type, "progressive");
  assert.equal(value.expires_in, 900);
  assert.ok(!JSON.stringify(value).includes(session));
  return value;
};

assert.equal((await request("/videos/native-test/playback-ticket", "POST", {}, "")).status, 401);
// A client asking for the progressive stream still gets a downloaded file as a file.
const preferred = await request("/videos/native-test/playback-ticket", "POST", { prefer: "progressive" });
assert.equal(preferred.status, 200);
assert.equal((await preferred.json() as { content_type: string }).content_type, "progressive");
const first = await issue();
// Request the same file without the long-lived API bearer, including byte seek.
const ranged = await app.request(`http://localhost${first.url.replace("compat=1", "compat=0")}`, { headers: { Range: "bytes=4-7" } });
assert.equal(ranged.status, 206);
assert.equal(ranged.headers.get("content-range"), "bytes 4-7/16");
assert.equal(ranged.headers.get("cache-control"), "private, no-store");
assert.equal(await ranged.text(), "4567");
// Exercise Bun's real HTTP writer too: in-memory app.request() does not expose
// the Bun.file().slice().stream() stall that prevents AVPlayer loading a file.
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
try {
  const network = await fetch(new URL(first.url.replace("compat=1", "compat=0"), server.url), {
    headers: { Range: "bytes=0-1" }, signal: AbortSignal.timeout(3000),
  });
  assert.equal(network.status, 206);
  assert.equal(network.headers.get("content-range"), "bytes 0-1/16");
  assert.equal(await network.text(), "01");
} finally { server.stop(true); }
const fileUrl = `http://localhost${first.url.replace("compat=1", "compat=0")}`;
for (const [range, expected] of [["bytes=-4", "cdef"], ["bytes=12-", "cdef"], ["bytes=14-99", "ef"]]) {
  const response = await app.request(fileUrl, { headers: { Range: range! } });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), expected);
}
for (const range of ["bytes=9-2", "bytes=16-", "bytes=-0", "bytes=-", "bytes=1-2,4-5"]) {
  const response = await app.request(fileUrl, { headers: { Range: range } });
  assert.equal(response.status, 416);
  assert.equal(response.headers.get("content-range"), "bytes */16");
}
for (const path of ["/feed", "/profiles", "/videos/other/stream", "/videos/native-test/file"]) {
  assert.equal((await request(`${path}?media_ticket=${first.ticket}`, "GET", undefined, "")).status, 401);
}
assert.equal((await app.request(`http://localhost${first.url}`, { method: "DELETE" })).status, 401);
assert.equal((await request("/videos/native-test/playback-ticket", "PUT", { ticket: first.ticket })).status, 200);
const otherSession = await createSession(1, "profile");
assert.equal((await request("/videos/native-test/playback-ticket", "PUT", { ticket: first.ticket }, otherSession)).status, 401);
await request("/videos/native-test/playback-ticket", "DELETE", { ticket: first.ticket });
assert.equal((await app.request(`http://localhost${first.url}`)).status, 401);

const switched = await issue();
const second = await database.prepare("INSERT INTO users(name,avatar_color,sort_order,portable_uuid) VALUES('Secondary','#123456',1,?) RETURNING id")
  .get<{ id: number }>(crypto.randomUUID());
await database.prepare("UPDATE auth_sessions SET user_id=? WHERE token=?").run(second!.id, token);
assert.equal((await app.request(`http://localhost${switched.url}`)).status, 401);
await database.prepare("UPDATE auth_sessions SET user_id=1 WHERE token=?").run(token);
const revoked = await issue();
await destroySession(token);
assert.equal((await app.request(`http://localhost${revoked.url}`)).status, 401);

// Child restrictions are rechecked after issuance, including a parent stop.
await database.prepare("UPDATE users SET is_child=1 WHERE id=?").run(second!.id);
await database.prepare("INSERT INTO download_owners(user_id,video_id,source) VALUES(?,'native-test','manual')").run(second!.id);
const childToken = await createSession(second!.id, "profile");
const childTicket = await issue(childToken);
await setUserSetting(second!.id, "child_hide_shorts", "1");
await database.prepare("UPDATE videos SET is_short=1 WHERE video_id='native-test'").run();
assert.equal((await app.request(`http://localhost${childTicket.url}`)).status, 403);
assert.equal((await request("/videos/native-test/playback-ticket", "POST", {}, childToken)).status, 403);

// Real auth middleware with a deterministic HLS response, no yt-dlp/network.
const hls = new Hono();
hls.use("*", serveMediaTicket);
hls.get("/api/videos/:id/hls/:file", (c) => c.body('#EXTM3U\n#EXT-X-MAP:URI="video.mp4?v=1",BYTERANGE="80@0"\nvideo.m3u8?v=1\nseg00001.ts\n', 200, { "Content-Type": "application/vnd.apple.mpegurl", "Content-Length": "999" }));
const hlsToken = mediaTickets.issue({ userId: 1, videoId: "native-test", sessionToken: otherSession, kind: "hls" });
const playlist = await hls.request(`http://localhost/api/videos/native-test/hls/index.m3u8?media_ticket=${hlsToken}`);
assert.equal(playlist.status, 200);
assert.equal(playlist.headers.get("content-length"), null);
const text = await playlist.text();
assert.equal(text.split("media_ticket=").length - 1, 3);
assert.ok(!text.includes(otherSession));
console.log("RESULT native playback authorization, byte seeking, profile isolation, revocation, child policy and HLS passed");
process.exit(0);
