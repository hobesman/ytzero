/**
 * The video a room's screen just asked its Echo for. The tablet can only type
 * the Echo a sentence ("ask hoban tube to play the video <title> from
 * <channel>"), and from the words alone the video skill searches: the
 * channels the profile follows first, then YouTube. A video from a channel
 * that isn't followed came out wrong (a followed channel with a similar name
 * won) or not at all (the search found nothing it could play).
 *
 * So the screen notes the exact video for its room as it types, and when that
 * room's Echo asks for a video in words like the ones typed, the skill plays
 * the noted one. A note lasts a minute and a half and is used once. It is
 * transient process state: never stored or backed up.
 */

const PICK_MS = 90_000;
/** The share of the typed words Alexa's version must keep; it drops and changes a few ("I'm" heard as "IM"). */
const MIN_OVERLAP = 0.6;

/** Lower-case words without accents or apostrophes: "Pokémon" and "pokemon", "I'm" and "im" are the same. */
const words = (text: string) => new Set(text.normalize("NFKD").replace(/\p{M}/gu, "").replace(/['’]/g, "").toLowerCase()
  .split(/[^\p{L}\p{N}]+/u).filter(Boolean));

/** How much of what was typed is in what Alexa heard, from 0 to 1. */
export function typedWordsKept(typed: string, heard: string): number {
  const sent = words(typed);
  if (!sent.size) return 0;
  const got = words(heard);
  let kept = 0;
  for (const word of sent) if (got.has(word)) kept += 1;
  return kept / sent.size;
}

export function createRoomVideoPicks(now: () => number = Date.now) {
  const picks = new Map<string, { videoId: string; words: string; at: number }>();
  const keyOf = (userId: number, room: string) => `${userId}\n${room.trim().toLowerCase()}`;
  return {
    /** The screen typed `words` to the room's Echo for this video. */
    note(userId: number, room: string, videoId: string, typed: string): void {
      for (const [key, pick] of picks) if (now() - pick.at > PICK_MS) picks.delete(key);
      picks.set(keyOf(userId, room), { videoId, words: typed, at: now() });
    },
    /** The noted video, if the room's Echo asked for it just now; used up once taken. */
    take(userId: number, room: string, heard: string): string | null {
      const key = keyOf(userId, room);
      const pick = picks.get(key);
      if (!pick || now() - pick.at > PICK_MS || typedWordsKept(pick.words, heard) < MIN_OVERLAP) return null;
      picks.delete(key);
      return pick.videoId;
    },
  };
}

export type RoomVideoPicks = ReturnType<typeof createRoomVideoPicks>;

/** The server's one store, shared by the room screen's routes and the video skill. */
export const roomVideoPicks = createRoomVideoPicks();
