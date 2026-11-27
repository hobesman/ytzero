import { randomBytes } from "node:crypto";
import { database } from "../database";
import type { AsyncDatabaseClient } from "../databaseClient";
import { parseStationSeed, type StationSeed } from "../music/musicStation";

/** The most songs one queue holds. */
export const ALEXA_QUEUE_MAX_SONGS = 500;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const QUEUE_ID = /^[A-Za-z0-9_-]{8,16}$/;
export const isQueueId = (value: unknown): value is string => typeof value === "string" && QUEUE_ID.test(value);

/** What "play my queue" plays in a room: specific songs, or a station such as an album. */
export interface AlexaRoomQueue {
  queueId: string;
  room: string;
  title: string;
  /** For a station queue; null for a list of songs. */
  seed: StationSeed | null;
  videoIds: string[];
  savedAt: string;
}

interface QueueRow { queue_id: string; room: string | null; title: string; seed: string | null; video_ids: string; saved_at: string }

const roomKey = (room: string) => room.toLowerCase();

function fromQueueRow(row: QueueRow, room: string): AlexaRoomQueue {
  let seed: StationSeed | null = null;
  try { seed = row.seed ? parseStationSeed(JSON.parse(row.seed)) : null; } catch { seed = null; }
  return {
    queueId: row.queue_id, room, title: row.title, seed,
    videoIds: row.video_ids.match(/[A-Za-z0-9_-]{11}/g) ?? [], savedAt: row.saved_at,
  };
}

/** Song IDs as given, valid ones only and capped. */
export function cleanVideoIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((id): id is string => typeof id === "string" && VIDEO_ID.test(id));
  return ids.length === value.length ? ids.slice(0, ALEXA_QUEUE_MAX_SONGS) : null;
}

/** Per-room settings that belong to the room, not one device: its Home Assistant entity and its queue. */
export function createAlexaRoomSettings(db: AsyncDatabaseClient = database) {
  return {
    /** The room as its settings spell it, if it has any. */
    async spelling(userId: number, room: string): Promise<string | null> {
      const row = await db.prepare("SELECT room FROM alexa_rooms WHERE user_id = ? AND room_key = ?").get<{ room: string }>(userId, roomKey(room));
      return row?.room ?? null;
    },

    async entity(userId: number, room: string): Promise<string | null> {
      const row = await db.prepare("SELECT ha_entity FROM alexa_rooms WHERE user_id = ? AND room_key = ?").get<{ ha_entity: string | null }>(userId, roomKey(room));
      return row?.ha_entity ?? null;
    },

    /** Every room's entity, keyed by lower-case room. */
    async entities(userId: number): Promise<Map<string, { room: string; entity: string }>> {
      const rows = await db.prepare("SELECT room_key, room, ha_entity FROM alexa_rooms WHERE user_id = ? AND ha_entity IS NOT NULL")
        .all<{ room_key: string; room: string; ha_entity: string }>(userId);
      return new Map(rows.map((row) => [row.room_key, { room: row.room, entity: row.ha_entity }]));
    },

    async setEntity(userId: number, room: string, entity: string | null, now: number): Promise<void> {
      await db.prepare(`INSERT INTO alexa_rooms (user_id, room_key, room, ha_entity, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (user_id, room_key) DO UPDATE SET ha_entity = excluded.ha_entity, updated_at = excluded.updated_at`)
        .run(userId, roomKey(room), room, entity, new Date(now).toISOString());
    },

    async queue(userId: number, room: string): Promise<AlexaRoomQueue | null> {
      const row = await db.prepare("SELECT queue_id, NULL AS room, title, seed, video_ids, saved_at FROM alexa_room_queues WHERE user_id = ? AND room_key = ?")
        .get<QueueRow>(userId, roomKey(room));
      return row ? fromQueueRow(row, room) : null;
    },

    /** A queue by the ID a stream token carries. Null once a newer queue replaced it. */
    async queueById(userId: number, queueId: string): Promise<AlexaRoomQueue | null> {
      if (!isQueueId(queueId)) return null;
      const row = await db.prepare(`SELECT q.queue_id, r.room, q.room_key, q.title, q.seed, q.video_ids, q.saved_at FROM alexa_room_queues q
        LEFT JOIN alexa_rooms r ON r.user_id = q.user_id AND r.room_key = q.room_key WHERE q.user_id = ? AND q.queue_id = ?`)
        .get<QueueRow & { room_key: string }>(userId, queueId);
      return row ? fromQueueRow(row, row.room ?? row.room_key) : null;
    },

    /** Replaces the room's queue with a new one, under a new ID. */
    async saveQueue(userId: number, room: string, queue: { title: string; seed: StationSeed | null; videoIds: string[] }, now: number): Promise<AlexaRoomQueue> {
      const queueId = randomBytes(6).toString("base64url");
      const savedAt = new Date(now).toISOString();
      const videoIds = queue.videoIds.slice(0, ALEXA_QUEUE_MAX_SONGS);
      // The room row keeps the room's spelling for a queue saved before any entity.
      await db.prepare(`INSERT INTO alexa_rooms (user_id, room_key, room, ha_entity, updated_at) VALUES (?, ?, ?, NULL, ?)
        ON CONFLICT (user_id, room_key) DO NOTHING`).run(userId, roomKey(room), room, savedAt);
      await db.prepare(`INSERT INTO alexa_room_queues (user_id, room_key, queue_id, title, seed, video_ids, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, room_key) DO UPDATE SET queue_id = excluded.queue_id, title = excluded.title, seed = excluded.seed,
          video_ids = excluded.video_ids, saved_at = excluded.saved_at`)
        .run(userId, roomKey(room), queueId, queue.title.slice(0, 200), queue.seed ? JSON.stringify(queue.seed) : null, videoIds.join(""), savedAt);
      return { queueId, room, title: queue.title.slice(0, 200), seed: queue.seed, videoIds, savedAt };
    },

    async clearQueue(userId: number, room: string): Promise<boolean> {
      const result = await db.prepare("DELETE FROM alexa_room_queues WHERE user_id = ? AND room_key = ?").run(userId, roomKey(room));
      return result.changes > 0;
    },

    /** Moves a room's settings and queue to its new name. */
    async rename(userId: number, from: string, to: string): Promise<number> {
      if (roomKey(from) === roomKey(to)) {
        return (await db.prepare("UPDATE alexa_rooms SET room = ? WHERE user_id = ? AND room_key = ?").run(to, userId, roomKey(from))).changes;
      }
      // The new name's own settings, if any, give way to the room being renamed.
      await db.prepare("DELETE FROM alexa_rooms WHERE user_id = ? AND room_key = ? AND EXISTS (SELECT 1 FROM alexa_rooms WHERE user_id = ? AND room_key = ?)")
        .run(userId, roomKey(to), userId, roomKey(from));
      await db.prepare("DELETE FROM alexa_room_queues WHERE user_id = ? AND room_key = ? AND EXISTS (SELECT 1 FROM alexa_room_queues WHERE user_id = ? AND room_key = ?)")
        .run(userId, roomKey(to), userId, roomKey(from));
      const changed = await db.prepare("UPDATE alexa_rooms SET room_key = ?, room = ? WHERE user_id = ? AND room_key = ?").run(roomKey(to), to, userId, roomKey(from));
      await db.prepare("UPDATE alexa_room_queues SET room_key = ? WHERE user_id = ? AND room_key = ?").run(roomKey(to), userId, roomKey(from));
      return changed.changes;
    },
  };
}

export type AlexaRoomSettings = ReturnType<typeof createAlexaRoomSettings>;
