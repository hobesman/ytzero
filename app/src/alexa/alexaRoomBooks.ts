import { database } from "../database";
import type { AsyncDatabaseClient } from "../databaseClient";
import { isBookId } from "../audiobookshelf/audiobookshelfClient";
import type { QueuedBook } from "./alexaBookSkill";

/**
 * The book a tablet queued for a room, for "ask hoban books to play my book":
 * a book ID and where to start, or null to start from its saved place.
 */
export interface AlexaRoomBook extends QueuedBook { room: string; savedAt: string }

const roomKey = (room: string) => room.toLowerCase();

export function createAlexaRoomBooks(db: AsyncDatabaseClient = database) {
  return {
    async get(userId: number, room: string): Promise<AlexaRoomBook | null> {
      const row = await db.prepare("SELECT book_id, title, start_seconds, saved_at FROM alexa_room_books WHERE user_id = ? AND room_key = ?")
        .get<{ book_id: string; title: string; start_seconds: number | null; saved_at: string }>(userId, roomKey(room));
      return row ? { room, bookId: row.book_id, title: row.title, startSeconds: row.start_seconds == null ? null : Number(row.start_seconds), savedAt: row.saved_at } : null;
    },

    async save(userId: number, room: string, book: QueuedBook, now: number): Promise<AlexaRoomBook> {
      if (!isBookId(book.bookId)) throw new Error("not a book ID");
      const savedAt = new Date(now).toISOString();
      const title = book.title.replace(/\s+/g, " ").trim().slice(0, 200);
      const start = book.startSeconds == null ? null : Math.max(0, book.startSeconds);
      // The room row keeps the room's spelling for a book queued before any entity.
      await db.prepare(`INSERT INTO alexa_rooms (user_id, room_key, room, ha_entity, updated_at) VALUES (?, ?, ?, NULL, ?)
        ON CONFLICT (user_id, room_key) DO NOTHING`).run(userId, roomKey(room), room, savedAt);
      await db.prepare(`INSERT INTO alexa_room_books (user_id, room_key, book_id, title, start_seconds, saved_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, room_key) DO UPDATE SET book_id = excluded.book_id, title = excluded.title, start_seconds = excluded.start_seconds,
          saved_at = excluded.saved_at`).run(userId, roomKey(room), book.bookId, title, start, savedAt);
      return { room, bookId: book.bookId, title, startSeconds: start, savedAt };
    },

    async clear(userId: number, room: string): Promise<boolean> {
      return (await db.prepare("DELETE FROM alexa_room_books WHERE user_id = ? AND room_key = ?").run(userId, roomKey(room))).changes > 0;
    },
  };
}

export type AlexaRoomBooks = ReturnType<typeof createAlexaRoomBooks>;
