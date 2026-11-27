import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AsyncDatabaseClient } from "../databaseClient";
import { saveAlexaVideoProgress } from "./alexaVideoProgress";

const NOW = Date.parse("2030-06-01T12:00:00Z");

describe("alexa video progress", () => {
  test("saves each playing video's estimated position, and nothing for paused, music or finished ones", async () => {
    const db = new AsyncDatabaseClient("sqlite", ":memory:");
    await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY)");
    await db.exec("INSERT INTO users (id) VALUES (1)");
    await db.exec(readFileSync(new URL("../alexaSchema.sql", import.meta.url), "utf8"));
    const insert = (device: string, skill: string, videoId: string, state: string, startedAgoMs: number | null, durationMs: number | null, offsetMs = 0) =>
      db.prepare(`INSERT INTO alexa_now_playing (user_id, skill, device_id, token, video_id, state, offset_ms, started_at, duration_ms, updated_at)
        VALUES (1, ?, ?, 't', ?, ?, ?, ?, ?, ?)`)
        .run(skill, device, videoId, state, offsetMs, startedAgoMs == null ? null : new Date(NOW - startedAgoMs).toISOString(), durationMs, new Date(NOW).toISOString());
    await insert("kitchen", "video", "playing0001", "playing", 95_000, 1_812_000);
    await insert("office", "video", "paused00001", "paused", null, 600_000, 42_000);
    await insert("den", "music", "song0000001", "playing", 60_000, 200_000);
    // Started longer ago than it lasts: the Echo stopped without saying so.
    await insert("hall", "video", "overrun0001", "playing", 700_000, 600_000);

    const saved: [number, string, number, number | null][] = [];
    expect(await saveAlexaVideoProgress(NOW, db, async (...args) => { saved.push(args); })).toBe(1);
    expect(saved).toEqual([[1, "playing0001", 95, 1812]]);
    await db.close();
  });
});
