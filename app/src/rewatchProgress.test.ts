import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_REWATCH_PROGRESS_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("rewatch progress suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/rewatchProgress.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-rewatch-progress-"));
  process.env.DB_PATH = resolve(root, "db.sqlite");

  const { db } = await import("./db");
  const { api } = await import("./routes");
  const { recordVideoProgress } = await import("./alexa/alexaVideoCatalog");

  db.prepare("INSERT INTO channels(channel_id,title,url) VALUES('UCre','Rewatch channel','')").run();
  db.prepare(`INSERT INTO videos(video_id,channel_id,title,is_short,published_at,is_unavailable) VALUES
    ('rewatch0001','UCre','Rewatched',0,'2099-01-01',0),
    ('nearend0001','UCre','Near the end',0,'2099-01-02',0),
    ('justopen001','UCre','Just opened',0,'2099-01-03',0),
    ('echo0000001','UCre','On an Echo',0,'2099-01-04',0)`).run();
  db.prepare(`INSERT INTO user_videos(user_id,video_id,status,watched,watch_position,watch_duration) VALUES
    (1,'rewatch0001','inbox',1,600,600),
    (1,'nearend0001','inbox',1,600,600),
    (1,'justopen001','inbox',1,600,600),
    (1,'echo0000001','inbox',1,600,600)`).run();
  db.prepare("INSERT INTO history(video_id,user_id) VALUES('rewatch0001',1)").run();

  const progress = (videoId: string, position: number) => api.request(`http://localhost/videos/${videoId}/progress`, {
    method: "PUT",
    headers: { Cookie: "ytzero_profile=1", "Content-Type": "application/json" },
    body: JSON.stringify({ position, duration: 600 }),
  });
  const state = (videoId: string) => db.prepare("SELECT watched, watch_position FROM user_videos WHERE user_id=1 AND video_id=?").get(videoId) as { watched: number | null; watch_position: number };

  afterAll(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe("playing a watched video again", () => {
    test("past its first 30 seconds, it isn't watched any more and keeps its history", async () => {
      expect((await progress("rewatch0001", 95)).status).toBe(200);
      expect(state("rewatch0001")).toEqual({ watched: null, watch_position: 95 });
      expect((db.prepare("SELECT COUNT(*) n FROM history WHERE video_id='rewatch0001'").get() as { n: number }).n).toBe(1);
    });

    test("just opening it, or progress near the end, leaves it watched", async () => {
      await progress("justopen001", 10);
      expect(state("justopen001").watched).toBe(1);
      await progress("nearend0001", 580);
      expect(state("nearend0001").watched).toBe(1);
    });

    test("an Echo's progress counts the same", async () => {
      await recordVideoProgress(1, "echo0000001", 120, null);
      expect(state("echo0000001")).toEqual({ watched: null, watch_position: 120 });
    });
  });
}
