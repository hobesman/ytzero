import { describe, expect, test } from "bun:test";
import { canDownloadToPhone, downloadFileBase, downloadFraction, downloadOwner, formatBytes, parseDownloadIndex, PhoneDownloadStore, type DownloadConnection } from "./phoneDownloads";
import type { NativeDownloadStatus, PhoneDownloadsNative } from "./phoneDownloadsNative";
import type { Video } from "./types";

const video = (id: string, patch: Partial<Video> = {}): Video => ({
  video_id: id, title: `Video ${id}`, description: "", thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, channel_title: "Channel",
  published_at: null, duration: "10:00", live_status: "none", watched: 0, status: "inbox", ...patch,
});

function fakeNative() {
  const files = new Map<string, string>();
  const statuses = new Map<string, NativeDownloadStatus>();
  const enqueued: { url: string; headers: Record<string, string>; name: string; allowMetered: boolean }[] = [];
  let next = 1;
  const native: PhoneDownloadsNative = {
    directoryUri: () => "file:///data/downloads",
    enqueue: async (url, headers, name, _title, allowMetered) => {
      const id = String(next++);
      enqueued.push({ url, headers, name, allowMetered });
      statuses.set(id, { id, status: "pending" });
      files.set(`${name}.part`, "");
      return id;
    },
    query: async (ids) => ids.map((id) => statuses.get(id) ?? { id, status: "missing" }),
    finish: async (id, name) => {
      files.delete(`${name}.part`);
      files.set(name, "video bytes");
      statuses.delete(id);
      return 1234;
    },
    cancel: async (id) => { statuses.delete(id); return true; },
    fetchFile: async (_url, _headers, name) => { files.set(name, "jpg"); return 10; },
    readText: async (name) => files.get(name) ?? null,
    writeText: async (name, text) => { files.set(name, text); return true; },
    deleteFile: async (name) => { files.delete(name); files.delete(`${name}.part`); return true; },
    fileSize: async (name) => files.has(name) ? 1 : -1,
    freeBytes: async () => 5e9,
  };
  return { native, files, statuses, enqueued };
}

function fakeServer() {
  const downloads = new Map<string, string>();
  const saved: { id: string; position: number; duration: number }[] = [];
  const watched: string[] = [];
  let online = true;
  let requestStatus = 200;
  const offline = () => { if (!online) throw new Error("offline"); };
  const api: DownloadConnection["api"] = {
    requestDeviceDownload: async (id, quality) => {
      offline();
      if (requestStatus !== 200) throw Object.assign(new Error("refused"), { status: requestStatus });
      downloads.set(id, `queued:${quality ?? ""}`);
      return { ok: true };
    },
    videoDownload: async (id) => {
      offline();
      const status = downloads.get(id)?.split(":")[0];
      return { download: status ? { status } : null, progress: status === "downloading" ? { percent: 40 } : null };
    },
    savePlaybackProgress: async (id, value) => { offline(); saved.push({ id, ...value }); },
    markWatched: async (id) => { offline(); watched.push(id); },
    thumbnailSource: (url) => ({ uri: `https://tube.test/api/img?u=${encodeURIComponent(url)}` }),
  };
  return {
    api, downloads, saved, watched,
    setOnline: (value: boolean) => { online = value; },
    refuse: (status: number) => { requestStatus = status; },
  };
}

// Timers run only when the test asks, so each poll step is explicit.
const manualTimers = () => ({ now: () => 1000, setTimeout: () => 1, clearTimeout: () => {} });
const owner = downloadOwner("https://tube.test/", 3);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function connectedStore() {
  const native = fakeNative();
  const server = fakeServer();
  const store = new PhoneDownloadStore(native.native, manualTimers());
  await store.connect({ owner, instanceUrl: "https://tube.test", accessToken: "token-1", api: server.api });
  return { native, server, store };
}

describe("phone downloads", () => {
  test("owners and file names are per profile", () => {
    expect(owner).toBe("https://tube.test#3");
    expect(downloadFileBase(owner, "abc")).not.toBe(downloadFileBase(downloadOwner("https://tube.test", 4), "abc"));
    expect(downloadFileBase(owner, "a/../b")).toMatch(/^[a-z0-9]+-a____b$/);
  });

  test("a download goes from the server to the phone, at the chosen quality", async () => {
    const { native, server, store } = await connectedStore();
    await store.download(video("v1"));
    expect(server.downloads.get("v1")).toBe("queued:720");
    expect(store.find("v1")?.state).toBe("server");

    server.downloads.set("v1", "downloading:");
    await store.poll();
    expect(store.find("v1")?.serverPercent).toBe(40);
    expect(downloadFraction(store.find("v1")!)).toBe(0.4);

    server.downloads.set("v1", "done:");
    await store.poll();
    const item = store.find("v1")!;
    expect(item.state).toBe("downloading");
    expect(native.enqueued[0]).toEqual({ url: "https://tube.test/api/videos/v1/file", headers: { Authorization: "Bearer token-1" }, name: item.file, allowMetered: false });

    native.statuses.set(item.nativeId!, { id: item.nativeId!, status: "paused", waiting: "wifi", downloaded: 0, total: 2000 });
    await store.poll();
    expect(store.find("v1")?.waiting).toBe("wifi");

    native.statuses.set(item.nativeId!, { id: item.nativeId!, status: "done" });
    await store.poll();
    expect(store.find("v1")).toMatchObject({ state: "done", size: 1234, nativeId: null });
    expect(store.localUri("v1")).toBe(`file:///data/downloads/${item.file}`);
    await flush();
    expect(store.find("v1")?.thumbnail).toBe(item.file.replace(/\.mp4$/, ".jpg"));
    expect(store.localThumbnail(video("v1").thumbnail)).toBe(`file:///data/downloads/${item.file.replace(/\.mp4$/, ".jpg")}`);
    expect(store.usedBytes()).toBe(1234);
  });

  test("the index survives a restart, and the last profile's downloads stay listed offline", async () => {
    const { native, store } = await connectedStore();
    await store.download(video("v1"));
    await store.settled();
    const restarted = new PhoneDownloadStore(native.native, manualTimers());
    await restarted.ready;
    expect(restarted.owner).toBe(owner);
    expect(restarted.downloads().map((item) => item.videoId)).toEqual(["v1"]);
  });

  test("a refused request says why", async () => {
    const { server, store } = await connectedStore();
    server.refuse(409);
    await store.download(video("v1"));
    expect(store.find("v1")).toMatchObject({ state: "failed", error: "disabled" });
    server.refuse(200);
    await store.retry("v1");
    expect(store.find("v1")?.state).toBe("server");
  });

  test("a download the server lost, or Android dropped, fails", async () => {
    const { native, server, store } = await connectedStore();
    await store.download(video("v1"));
    server.downloads.delete("v1");
    await store.poll();
    expect(store.find("v1")?.error).toBe("server");

    await store.retry("v1");
    server.downloads.set("v1", "done:");
    await store.poll();
    native.statuses.clear();
    await store.poll();
    expect(store.find("v1")).toMatchObject({ state: "failed", error: "transfer" });
  });

  test("removing a download cancels it and deletes its files", async () => {
    const { native, server, store } = await connectedStore();
    await store.download(video("v1"));
    server.downloads.set("v1", "done:");
    await store.poll();
    const item = store.find("v1")!;
    await store.remove("v1");
    expect(store.find("v1")).toBeNull();
    expect(native.statuses.has(item.nativeId!)).toBe(false);
    expect([...native.files.keys()].filter((name) => name.includes("v1"))).toEqual([]);
  });

  test("positions saved offline reach the server when it is back", async () => {
    const { server, store } = await connectedStore();
    await store.download(video("v1"));
    store.recordPlayback("v1", { position: 120, duration: 600 }, false, true);
    store.recordPlayback("v1", { position: 0, duration: 0 }, true, true);
    expect(store.find("v1")?.video).toMatchObject({ watch_position: 120, watch_duration: 600, watched: 1 });
    expect(store.snapshot().pending).toHaveLength(1);

    server.setOnline(false);
    await store.flushPending();
    expect(store.snapshot().pending).toHaveLength(1);

    server.setOnline(true);
    await store.connect({ owner, instanceUrl: "https://tube.test", api: server.api });
    await flush();
    expect(server.saved).toEqual([{ id: "v1", position: 120, duration: 600 }]);
    expect(server.watched).toEqual(["v1"]);
    expect(store.snapshot().pending).toEqual([]);
  });

  test("another profile sees only its own downloads", async () => {
    const { server, store } = await connectedStore();
    await store.download(video("v1"));
    await store.connect({ owner: downloadOwner("https://tube.test", 4), instanceUrl: "https://tube.test", api: server.api });
    expect(store.downloads()).toEqual([]);
    expect(store.localUri("v1")).toBeNull();
  });

  test("malformed index files are ignored", () => {
    expect(parseDownloadIndex("not json").downloads).toEqual([]);
    expect(parseDownloadIndex(JSON.stringify({ version: 1, downloads: [{ owner: 1 }], quality: "4k", allowMetered: "yes" })))
      .toMatchObject({ downloads: [], quality: "720", allowMetered: false });
  });

  test("live, private and members-only videos can't be saved", () => {
    expect(canDownloadToPhone(video("a"))).toBe(true);
    expect(canDownloadToPhone(video("a", { live_status: "live" }))).toBe(false);
    expect(canDownloadToPhone(video("a", { members_only: 1 }))).toBe(false);
    expect(canDownloadToPhone(video("a", { downloads_allowed: false }))).toBe(false);
  });

  test("sizes read naturally", () => {
    expect(formatBytes(512, "en")).toBe("512 B");
    expect(formatBytes(1_234_000, "en")).toBe("1.2 MB");
    expect(formatBytes(2_300_000_000, "de")).toBe("2,3 GB");
  });
});
