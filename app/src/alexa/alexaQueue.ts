import type { StoredMusicTrack } from "../music/musicCatalog";
import type { MusicStations } from "../music/musicStation";
import type { AlexaPlaybackState, AlexaQueueRef } from "./alexaPlayback";
import type { AlexaRoomQueue } from "./alexaRoomSettings";

/**
 * "Play my queue": the asking Echo's room has a queue saved from a tablet,
 * either a list of songs or a station seed such as an album, playlist or
 * artist radio. The stream token carries the queue's ID and the song's place,
 * so a long queue stays on the server. A list of songs runs into a station
 * like its last song once it ends, the way an album does.
 */
export interface AlexaQueueSource {
  /** The room the device is paired with, and that room's queue. */
  forDevice: (userId: number, deviceId: string) => Promise<{ room: string | null; queue: AlexaRoomQueue | null }>;
  byId: (userId: number, queueId: string) => Promise<AlexaRoomQueue | null>;
}

type FindTrack = (videoId: string) => Promise<StoredMusicTrack | null>;

/** The first playable song from `from` on, with its place. */
async function songFrom(queue: AlexaRoomQueue, from: number, findTrack: FindTrack): Promise<{ track: StoredMusicTrack; ref: AlexaQueueRef } | null> {
  for (let index = from; index < queue.videoIds.length; index += 1) {
    const track = await findTrack(queue.videoIds[index]!);
    if (track) return { track, ref: { id: queue.queueId, index } };
  }
  return null;
}

/** What to say, or the station to start, for "play my queue" on this device. */
export async function startRoomQueue(
  source: AlexaQueueSource,
  dependencies: { findTrack: FindTrack; stations: Pick<MusicStations, "next"> },
  userId: number,
  deviceId: string | undefined,
): Promise<{ state: AlexaPlaybackState; track: StoredMusicTrack; speech: string } | string> {
  if (!deviceId) return "I can't tell which Echo this is.";
  const { room, queue } = await source.forDevice(userId, deviceId);
  if (!room) return "This Echo isn't paired with a room yet, so it has no queue. Say, for example, this is the kitchen.";
  if (!queue || (!queue.seed && !queue.videoIds.length)) return `There's nothing queued for the ${room}.`;
  const named = queue.title ? `Playing ${queue.title}.` : null;
  if (queue.seed) {
    const [first] = await dependencies.stations.next(userId, queue.seed, [], [], 1);
    if (!first) return `I couldn't find anything to play in the ${room} queue.`;
    return { state: { seed: queue.seed, videoId: first.videoId, served: [], skipped: [], failures: 0 }, track: first, speech: named ?? `Playing the ${room} queue.` };
  }
  const found = await songFrom(queue, 0, dependencies.findTrack);
  if (!found) return `I couldn't play any of the songs in the ${room} queue.`;
  const last = queue.videoIds.at(-1)!;
  return {
    state: { seed: { kind: "track", videoId: last }, videoId: found.track.videoId, served: [], skipped: [], failures: 0, queue: found.ref },
    track: found.track,
    speech: named ?? `Playing the ${room} queue, starting with ${found.track.title}.`,
  };
}

/** The queue's next song after the current one, or null once the queue is done or replaced. */
export async function nextInQueue(source: AlexaQueueSource, findTrack: FindTrack, userId: number, state: AlexaPlaybackState): Promise<{ track: StoredMusicTrack; ref: AlexaQueueRef } | null> {
  if (!state.queue) return null;
  const queue = await source.byId(userId, state.queue.id);
  if (!queue || queue.seed) return null;
  return songFrom(queue, state.queue.index + 1, findTrack);
}
