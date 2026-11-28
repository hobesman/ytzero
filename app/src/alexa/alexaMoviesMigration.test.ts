import { expect, test } from "bun:test";
import { AsyncDatabaseClient } from "../databaseClient";
import { applyDatabaseMigrations, DATABASE_MIGRATIONS } from "../databaseMigrations";

test("the movies migration keeps existing Echo rows and accepts the movies skill", async () => {
  const database = new AsyncDatabaseClient("sqlite", ":memory:");
  await database.exec("CREATE TABLE users (id INTEGER PRIMARY KEY)");
  await database.exec("INSERT INTO users (id) VALUES (1)");
  await database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  for (const migration of DATABASE_MIGRATIONS.filter((item) => item.version < 122)) {
    await database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(migration.version, migration.name, "2026-11-01T00:00:00.000Z");
  }
  // The Alexa tables as migrations 122 to 126 made them, with a paired Echo and some history.
  for (const migration of DATABASE_MIGRATIONS.filter((item) => item.version >= 122 && item.version < 127)) {
    for (const step of migration.sqlite) if (step.kind === "sql") await database.exec(step.statement);
    await database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(migration.version, migration.name, "2026-11-01T00:00:00.000Z");
  }
  await database.exec("INSERT INTO alexa_devices (user_id, skill, device_id, room, paired_at, last_seen_at) VALUES (1, 'books', 'echo-1', 'Kitchen', 'x', 'y')");
  await database.exec("INSERT INTO alexa_room_history (user_id, room_key, skill, item_id, title, played_at) VALUES (1, 'kitchen', 'music', 'abcdefghijk', 'Song', 'z')");
  expect(() => database.exec("INSERT INTO alexa_devices (user_id, skill, device_id, last_seen_at) VALUES (1, 'movies', 'echo-2', 'y')")).toThrow();

  expect(await applyDatabaseMigrations(database)).toBe(DATABASE_MIGRATIONS.at(-1)!.version);
  expect(await database.prepare("SELECT room FROM alexa_devices WHERE device_id = 'echo-1'").get() as unknown).toEqual({ room: "Kitchen" });
  expect(await database.prepare("SELECT title FROM alexa_room_history WHERE item_id = 'abcdefghijk'").get() as unknown).toEqual({ title: "Song" });
  await database.exec("INSERT INTO alexa_devices (user_id, skill, device_id, last_seen_at) VALUES (1, 'movies', 'echo-2', 'y')");
  await database.exec("INSERT INTO alexa_now_playing (user_id, skill, device_id, token, video_id, state, offset_ms, updated_at) VALUES (1, 'movies', 'echo-2', 'pm1.101', '101', 'playing', 0, 'z')");
  await database.exec("INSERT INTO alexa_pending_play (user_id, skill, device_id, token, video_id, requested_at) VALUES (1, 'movies', 'echo-2', 'pm1.101', '101', 'y')");
  await database.exec("INSERT INTO alexa_room_history (user_id, room_key, skill, item_id, played_at) VALUES (1, 'kitchen', 'movies', '101', 'z')");
  expect(() => database.exec("INSERT INTO alexa_devices (user_id, skill, device_id, last_seen_at) VALUES (1, 'radio', 'echo-4', 'y')")).toThrow();
  await database.close();
});
