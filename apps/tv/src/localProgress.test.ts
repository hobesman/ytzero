import { describe, expect, test } from "bun:test";
import { localProgressStore } from "./localProgress";

function memoryStore(initial?: string) {
  const values = new Map<string, string>(initial ? [["ytzero.tv.unsynced-positions", initial]] : []);
  return {
    values,
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { values.set(key, value); },
  };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe("unsynced watch positions", () => {
  test("keeps a position until the server saves it, and survives a restart", async () => {
    let time = 1_000_000;
    const store = memoryStore();
    const progress = localProgressStore(store, () => time);
    await progress.ready;
    progress.setOwner("https://yt.test#1");
    progress.record("a", { position: 600, duration: 1200 }, true);
    await progress.persist();
    // The app is killed here. On the next start, the position is still there.
    const restarted = localProgressStore(store, () => time);
    await restarted.ready;
    restarted.setOwner("https://yt.test#1");
    expect(restarted.pending("a")?.position).toBe(600);
    expect(restarted.apply({ video_id: "a", watch_position: 120, watch_duration: 1200 }).watch_position).toBe(600);
    // An older save confirmed later does not clear the newer position.
    restarted.synced("a", { position: 120, duration: 1200 });
    expect(restarted.pending("a")?.position).toBe(600);
    restarted.synced("a", { position: 600, duration: 1200 });
    expect(restarted.pending("a")).toBeNull();
    await restarted.persist();
    expect(JSON.parse(store.values.get("ytzero.tv.unsynced-positions")!)).toEqual({});
    time++;
  });

  test("belongs to one instance and profile", async () => {
    const progress = localProgressStore(memoryStore());
    await progress.ready;
    progress.setOwner("https://yt.test#1");
    progress.record("a", { position: 60, duration: 100 });
    progress.setOwner("https://yt.test#2");
    expect(progress.pending("a")).toBeNull();
    progress.setOwner(null);
    progress.record("b", { position: 60, duration: 100 });
    expect(progress.pending("b")).toBeNull();
  });

  test("flush sends each position and keeps the ones that fail", async () => {
    const progress = localProgressStore(memoryStore());
    await progress.ready;
    progress.setOwner("https://yt.test#1");
    progress.record("a", { position: 60, duration: 100 });
    progress.record("b", { position: 70, duration: 100 });
    const sent: string[] = [];
    await progress.flush(async (id, value) => {
      sent.push(`${id}@${value.position}`);
      if (id === "b") throw new Error("offline");
    }, async (id) => ({ video_id: id, watch_position: null }));
    expect(sent.sort()).toEqual(["a@60", "b@70"]);
    expect(progress.pending("a")).toBeNull();
    expect(progress.pending("b")?.position).toBe(70);
  });

  test("a position another device saved since wins over this device's unsynced one", async () => {
    const progress = localProgressStore(memoryStore());
    await progress.ready;
    progress.setOwner("o");
    // This device started at the server's 100 and got to 300 without syncing.
    progress.record("a", { position: 200, duration: 1000 }, false, 100);
    progress.record("a", { position: 300, duration: 1000 }, false, 150);
    expect(progress.pending("a")?.base).toBe(100);
    expect(progress.apply({ video_id: "a", watch_position: 100, watch_duration: 1000 }).watch_position).toBe(300);
    // Another device has since saved 700: the server's position is used and kept.
    expect(progress.apply({ video_id: "a", watch_position: 700, watch_duration: 1000 }).watch_position).toBe(700);
    const sent: string[] = [];
    await progress.flush(async (id, value) => { sent.push(`${id}@${value.position}`); }, async (id) => ({ video_id: id, watch_position: 700 }));
    expect(sent).toEqual([]);
    expect(progress.pending("a")).toBeNull();
  });

  test("this device's own earlier save does not count as another device's", async () => {
    const progress = localProgressStore(memoryStore());
    await progress.ready;
    progress.setOwner("o");
    progress.record("a", { position: 200, duration: 1000 }, false, 100);
    progress.record("a", { position: 260, duration: 1000 });
    // The save of 200 arrives after the player moved on to 260.
    progress.synced("a", { position: 200, duration: 1000 });
    expect(progress.pending("a")?.base).toBe(200);
    const sent: string[] = [];
    await progress.flush(async (id, value) => { sent.push(`${id}@${value.position}`); }, async (id) => ({ video_id: id, watch_position: 200 }));
    expect(sent).toEqual(["a@260"]);
    expect(progress.pending("a")).toBeNull();
  });

  test("an unreachable server keeps the entry for later", async () => {
    const progress = localProgressStore(memoryStore());
    await progress.ready;
    progress.setOwner("o");
    progress.record("a", { position: 200, duration: 1000 }, false, 100);
    await progress.flush(async () => {}, async () => { throw new Error("offline"); });
    expect(progress.pending("a")?.position).toBe(200);
  });

  test("a finished video is forgotten; old or extra entries are dropped", async () => {
    let time = 0;
    const progress = localProgressStore(memoryStore(), () => time);
    await progress.ready;
    progress.setOwner("o");
    progress.record("done", { position: 60, duration: 100 });
    progress.clear("done");
    expect(progress.pending("done")).toBeNull();
    for (let i = 0; i < 30; i++) { time = i; progress.record(`v${i}`, { position: 10, duration: 100 }); }
    expect(progress.pending("v0")).toBeNull();
    expect(progress.pending("v29")).not.toBeNull();
    time += 31 * 24 * 60 * 60_000;
    progress.record("new", { position: 10, duration: 100 });
    expect(progress.pending("v29")).toBeNull();
    expect(progress.pending("new")).not.toBeNull();
  });

  test("throttles writes while playing, and never overwrites entries it has not read yet", async () => {
    let time = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const store = memoryStore(JSON.stringify({ o: { old: { position: 30, duration: 100, at: 0 } } }));
    const slow = { ...store, getItemAsync: async (key: string) => { await gate; return store.getItemAsync(key); } };
    const progress = localProgressStore(slow, () => time);
    progress.setOwner("o");
    progress.record("a", { position: 10, duration: 100 }, true);
    release();
    await progress.ready; await flush();
    expect(Object.keys(JSON.parse(store.values.get("ytzero.tv.unsynced-positions")!).o).sort()).toEqual(["a", "old"]);
    time = 1000;
    progress.record("a", { position: 11, duration: 100 });
    await flush();
    expect(JSON.parse(store.values.get("ytzero.tv.unsynced-positions")!).o.a.position).toBe(10);
    time = 6000;
    progress.record("a", { position: 16, duration: 100 });
    await progress.persist(); await flush();
    expect(JSON.parse(store.values.get("ytzero.tv.unsynced-positions")!).o.a.position).toBe(16);
  });
});
