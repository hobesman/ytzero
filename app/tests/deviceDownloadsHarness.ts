const { api } = await import("../src/routes");
const { db } = await import("../src/db");
const { sweepUnclaimedDeviceDownloads } = await import("../src/deviceDownloads");
const { existsSync } = await import("node:fs");
const { join } = await import("node:path");

db.prepare("INSERT INTO channels(channel_id,title,url) VALUES('UC-device','Device channel','')").run();
for (const id of ["device-only", "device-kept", "device-upgraded", "device-stale", "device-fresh"]) {
  db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail) VALUES(?,'UC-device',?,'')").run(id, id);
}
const request = (path: string, init?: RequestInit) => api.request(`http://localhost${path}`, {
  ...init,
  headers: { Cookie: "ytzero_profile=1", "Content-Type": "application/json", ...(init?.headers ?? {}) },
});
const post = (id: string, body: Record<string, unknown>) => request(`/videos/${id}/download`, { method: "POST", body: JSON.stringify(body) });
const owner = (id: string) => db.prepare("SELECT source FROM download_owners WHERE user_id=1 AND video_id=?").get(id) ?? null;
const physical = (id: string) => db.prepare("SELECT status FROM downloads WHERE video_id=?").get(id) ?? null;
const finish = async (id: string, finishedAt = "datetime('now')") => {
  const path = join(Bun.env.DOWNLOADS_DIR!, `${id}.mp4`);
  await Bun.write(path, `${id} bytes`);
  db.prepare(`UPDATE downloads SET status='done', path=?, size_bytes=?, finished_at=${finishedAt} WHERE video_id=?`).run(path, `${id} bytes`.length, id);
  return path;
};

await request("/downloads/config", { method: "PUT", body: JSON.stringify({ enabled: true }) });

// A device-only request queues the job, and the full transfer releases it.
const deviceOnlyResponse = await post("device-only", { device: true });
const deviceOnlyQueued = { status: deviceOnlyResponse.status, owner: owner("device-only"), physical: physical("device-only") };
const deviceOnlyPath = await finish("device-only");
const fileResponse = await request("/videos/device-only/file");
const fileBody = await fileResponse.text();
await Bun.sleep(50);
const deviceOnlyAfter = { body: fileBody, length: fileResponse.headers.get("content-length"), owner: owner("device-only"), physical: physical("device-only"), fileExists: existsSync(deviceOnlyPath) };

// An existing server copy is kept when the profile also asks for its device.
await post("device-kept", {});
await post("device-kept", { device: true });
const keptOwner = owner("device-kept");
const keptPath = await finish("device-kept");
await (await request("/videos/device-kept/file")).text();
await Bun.sleep(50);
const keptAfter = { owner: owner("device-kept"), physical: physical("device-kept"), fileExists: existsSync(keptPath) };

// Asking for a server copy after a device request keeps the copy.
await post("device-upgraded", { device: true });
await post("device-upgraded", {});
const upgradedOwner = owner("device-upgraded");

// Unfetched device-only copies are released after a day, not before.
await post("device-stale", { device: true });
await finish("device-stale", "datetime('now','-25 hours')");
await post("device-fresh", { device: true });
await finish("device-fresh", "datetime('now','-1 hours')");
const swept = await sweepUnclaimedDeviceDownloads();
const sweep = { swept, stale: owner("device-stale"), fresh: owner("device-fresh") };

console.log("RESULT " + JSON.stringify({ deviceOnlyQueued, deviceOnlyAfter, keptOwner, keptAfter, upgradedOwner, sweep }));
process.exit(0);
