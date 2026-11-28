import { database } from "../database";
import type { AsyncDatabaseClient } from "../databaseClient";
import type { AlexaSkillKind } from "./alexaNowPlaying";

/**
 * What each room's Echo played lately, for the tablet's "recently played
 * here": unlike the profile's history, it is one room's. Playing an item again
 * moves it to the top rather than adding a row, and only the latest few per
 * room and skill are kept.
 */
export interface RoomHistoryItem {
  skill: AlexaSkillKind;
  /** The song's or video's ID, or the book's. */
  itemId: string;
  title: string;
  artist: string;
  art: string;
  playedAt: string;
}

export const ROOM_HISTORY_LIMIT = 30;
const roomKey = (room: string) => room.toLowerCase();

export function createAlexaRoomHistory(db: AsyncDatabaseClient = database) {
  return {
    async record(userId: number, room: string, item: Omit<RoomHistoryItem, "playedAt">, now: number): Promise<void> {
      const playedAt = new Date(now).toISOString();
      const clip = (value: string, length: number) => value.replace(/\s+/g, " ").trim().slice(0, length);
      await db.prepare(`INSERT INTO alexa_room_history (user_id, room_key, skill, item_id, title, artist, art, played_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, room_key, skill, item_id) DO UPDATE SET title = excluded.title, artist = excluded.artist, art = excluded.art,
          played_at = excluded.played_at`)
        .run(userId, roomKey(room), item.skill, item.itemId.slice(0, 64), clip(item.title, 300), clip(item.artist, 200), item.art.slice(0, 2000), playedAt);
      // Everything past the newest few for this room and skill goes.
      const cutoff = await db.prepare(`SELECT played_at FROM alexa_room_history WHERE user_id = ? AND room_key = ? AND skill = ?
        ORDER BY played_at DESC LIMIT 1 OFFSET ?`).get<{ played_at: string }>(userId, roomKey(room), item.skill, ROOM_HISTORY_LIMIT - 1);
      if (cutoff) {
        await db.prepare("DELETE FROM alexa_room_history WHERE user_id = ? AND room_key = ? AND skill = ? AND played_at < ?")
          .run(userId, roomKey(room), item.skill, cutoff.played_at);
      }
    },

    async list(userId: number, room: string, skill: AlexaSkillKind, limit = ROOM_HISTORY_LIMIT): Promise<RoomHistoryItem[]> {
      const rows = await db.prepare(`SELECT skill, item_id, title, artist, art, played_at FROM alexa_room_history
        WHERE user_id = ? AND room_key = ? AND skill = ? ORDER BY played_at DESC LIMIT ?`)
        .all<{ skill: AlexaSkillKind; item_id: string; title: string; artist: string; art: string; played_at: string }>(userId, roomKey(room), skill, limit);
      return rows.map((row) => ({ skill: row.skill, itemId: row.item_id, title: row.title, artist: row.artist, art: row.art, playedAt: row.played_at }));
    },
  };
}

export type AlexaRoomHistory = ReturnType<typeof createAlexaRoomHistory>;
