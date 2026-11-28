/**
 * The movie or episode a room's screen just asked its Echo for. The tablet
 * types "ask hoban plex to play my pick" to the room's Echo, and Hoban Plex
 * plays the title noted here for that room, from the place chosen (or from
 * the title's saved place in Plex). Words typed for a title would be
 * searched for again, and could find another film or episode; the note plays
 * the one tapped.
 *
 * A note lasts a minute and a half and is used once. It is transient process
 * state: never stored or backed up.
 */
export interface RoomPlexPick { itemId: string; startSeconds: number | null }

const PICK_MS = 90_000;

export function createRoomPlexPicks(now: () => number = Date.now) {
  const picks = new Map<string, RoomPlexPick & { at: number }>();
  const keyOf = (userId: number, room: string) => `${userId}\n${room.trim().toLowerCase()}`;
  return {
    note(userId: number, room: string, pick: RoomPlexPick): void {
      for (const [key, noted] of picks) if (now() - noted.at > PICK_MS) picks.delete(key);
      picks.set(keyOf(userId, room), { ...pick, at: now() });
    },
    /** The noted title, if there is one still fresh; used up once taken. */
    take(userId: number, room: string): RoomPlexPick | null {
      const key = keyOf(userId, room);
      const pick = picks.get(key);
      picks.delete(key);
      return pick && now() - pick.at <= PICK_MS ? { itemId: pick.itemId, startSeconds: pick.startSeconds } : null;
    },
  };
}

export type RoomPlexPicks = ReturnType<typeof createRoomPlexPicks>;

/** The server's one store, shared by the room screen's routes and Hoban Plex. */
export const roomPlexPicks = createRoomPlexPicks();
