import { log } from "../logger";
import { RoomControlError, roomSpelling, type RoomControlDependencies, type RoomControlResult } from "./alexaRoomControl";
import { roomPlexPicks, type RoomPlexPick, type RoomPlexPicks } from "./alexaRoomPlexPicks";

/**
 * Starts a movie or an episode on a room's Echo from its tablet: notes the
 * exact title for the room, then types "ask <Hoban Plex> to play my pick" to
 * the Echo through Home Assistant. The skill plays the noted title.
 */
export async function playRoomPlex(
  dependencies: RoomControlDependencies, userId: number, roomName: string, pick: RoomPlexPick, picks: RoomPlexPicks = roomPlexPicks,
): Promise<RoomControlResult> {
  if (!dependencies.skills.movies) throw new RoomControlError("The Hoban Plex skill isn't configured.");
  const invocation = dependencies.invocations.movies;
  if (!invocation) throw new RoomControlError("Set YTZERO_ALEXA_MOVIES_INVOCATION to the skill's invocation name first.");
  const devices = await dependencies.rooms.devices(userId);
  const room = await roomSpelling(devices, dependencies.settings, userId, roomName);
  const entity = await dependencies.settings.entity(userId, room);
  if (!entity) throw new RoomControlError(`The ${room} has no Home Assistant Echo yet.`);
  const command = `ask ${invocation} to play my pick`;
  // Noted before typing: the Echo can ask the skill before Home Assistant answers.
  picks.note(userId, room, pick);
  try {
    await dependencies.homeAssistant.typeCommand(entity, command);
  } catch (error) {
    throw new RoomControlError(error instanceof Error ? error.message : String(error), 502);
  }
  log.info("alexa.room_plex_started", { room, itemId: pick.itemId });
  return { room, entity, via: "typed", command };
}
