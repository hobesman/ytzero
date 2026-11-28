import { expect, test } from "bun:test";
import { AsyncDatabaseClient } from "../databaseClient";
import { applyDatabaseMigrations, DATABASE_MIGRATIONS } from "../databaseMigrations";

test("the books migration keeps existing Echo rows and accepts the books skill", async () => {
  const database = new AsyncDatabaseClient("sqlite", ":memory:");
  await database.exec("CREATE TABLE users (id INTEGER PRIMARY KEY)");
  await database.exec("INSERT INTO users (id) VALUES (1)");
  const before = DATABASE_MIGRATIONS.filter((migration) => migration.version < 126 && migration.version >= 122);
  await database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  for (const migration of DATABASE_MIGRATIONS.filter((item) => item.version < 122)) {
    await database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(migration.version, migration.name, "2026-11-01T00:00:00.000Z");
  }
  // The Alexa tables as migrations 122 to 125 made them, with a paired Echo.
  for (const migration of before) {
    for (const step of migration.sqlite) if (step.kind === "sql") await database.exec(step.statement);
    await database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(migration.version, migration.name, "2026-11-01T00:00:00.000Z");
  }
  await database.exec("INSERT INTO alexa_devices (user_id, skill, device_id, room, paired_at, last_seen_at) VALUES (1, 'music', 'echo-1', 'Kitchen', 'x', 'y')");
  await database.exec("INSERT INTO alexa_now_playing (user_id, skill, device_id, token, video_id, state, offset_ms, updated_at) VALUES (1, 'video', 'echo-2', 't', 'v', 'paused', 5, 'z')");
  expect(() => database.exec("INSERT INTO alexa_devices (user_id, skill, device_id, last_seen_at) VALUES (1, 'books', 'echo-3', 'y')")).toThrow();

  expect(await applyDatabaseMigrations(database)).toBe(126);
  expect(await database.prepare("SELECT room FROM alexa_devices WHERE device_id = 'echo-1'").get() as unknown).toEqual({ room: "Kitchen" });
  expect(await database.prepare("SELECT offset_ms FROM alexa_now_playing WHERE device_id = 'echo-2'").get() as unknown).toEqual({ offset_ms: 5 });
  await database.exec("INSERT INTO alexa_devices (user_id, skill, device_id, last_seen_at) VALUES (1, 'books', 'echo-3', 'y')");
  await database.exec("INSERT INTO alexa_pending_play (user_id, skill, device_id, token, video_id, requested_at) VALUES (1, 'books', 'echo-3', 'hb1.x.0', 'x', 'y')");
  await database.exec("INSERT INTO alexa_room_books (user_id, room_key, book_id, saved_at) VALUES (1, 'kitchen', 'abc', 'y')");
  expect(() => database.exec("INSERT INTO alexa_devices (user_id, skill, device_id, last_seen_at) VALUES (1, 'radio', 'echo-4', 'y')")).toThrow();
  await database.close();
});
