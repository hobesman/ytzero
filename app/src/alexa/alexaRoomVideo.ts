import { log } from "../logger";
import type { AlexaChannel, AlexaVideo } from "./alexaVideoCatalog";
import { RoomControlError, roomSpelling, type RoomControlDependencies, type RoomControlResult } from "./alexaRoomControl";
import { roomVideoPicks, type RoomVideoPicks } from "./alexaRoomVideoPicks";

/**
 * Starts a video on a room's Echo from a screen. The video skill has no queue,
 * so the Echo is typed what someone would say: "ask hoban tube to play the
 * video <title> from <channel>". The skill matches that against the channel's
 * videos in YT Zero, where a whole title scores highest, so it finds the video
 * the screen showed (and resumes it where the profile left off).
 *
 * A video YT Zero doesn't have (a YouTube search result) comes with the title
 * and channel the screen showed. The skill doesn't know that channel either.
 * The words are only the skill's way to it when the screen's note of the exact
 * video is gone (see alexaRoomVideoPicks): with it, the skill plays that video.
 */
export type RoomVideoRequest =
  | { kind: "video"; videoId: string; title?: string; channel?: string }
  | { kind: "latest"; channelId: string }
  | { kind: "shuffle"; channelId: string };

const VIDEO_ID = /^[\w-]{11}$/;
const CHANNEL_ID = /^UC[\w-]{22}$/;
/** Enough of a title to pick it out; Alexa's typed commands are short sentences. */
const MAX_TITLE_WORDS = 14;

export function parseRoomVideoRequest(body: Record<string, unknown> | null): RoomVideoRequest | null {
  if (body?.kind === "video" && typeof body.videoId === "string" && VIDEO_ID.test(body.videoId)) {
    const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : undefined;
    const title = text(body.title);
    const channel = text(body.channel);
    return { kind: "video", videoId: body.videoId, ...(title && channel ? { title, channel } : {}) };
  }
  if ((body?.kind === "latest" || body?.kind === "shuffle") && typeof body.channelId === "string" && CHANNEL_ID.test(body.channelId)) {
    return { kind: body.kind, channelId: body.channelId };
  }
  return null;
}

/** A title or name as it would be said: letters, numbers and spaces. */
export function spokenWords(text: string, maxWords = MAX_TITLE_WORDS): string {
  return text
    .normalize("NFKC")
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ")
    .toLowerCase();
}

export interface RoomVideoLookup {
  video: (videoId: string) => Promise<AlexaVideo | null>;
  followed: () => Promise<AlexaChannel[]>;
}

/** What to type for the request, or why it can't be played. */
export async function roomVideoCommand(invocation: string, request: RoomVideoRequest, lookup: RoomVideoLookup): Promise<string> {
  if (request.kind === "video") {
    const video = await lookup.video(request.videoId);
    if (!video && !(request.title && request.channel)) throw new RoomControlError("YT Zero doesn't know that video.", 404);
    if (video && !video.playable) throw new RoomControlError("That video can't be played on an Echo.", 400);
    const title = spokenWords(video?.title ?? request.title ?? "");
    const channel = spokenWords(video?.channelTitle ?? request.channel ?? "");
    if (!title || !channel) throw new RoomControlError("That video's title can't be said.", 400);
    return `ask ${invocation} to play the video ${title} from ${channel}`;
  }
  const channel = (await lookup.followed()).find((item) => item.channelId === request.channelId);
  if (!channel) throw new RoomControlError("The profile doesn't follow that channel.", 404);
  const name = spokenWords(channel.title);
  if (!name) throw new RoomControlError("That channel's name can't be said.", 400);
  return request.kind === "latest" ? `ask ${invocation} to play the latest from ${name}` : `ask ${invocation} to shuffle ${name}`;
}

export async function playRoomVideo(
  dependencies: RoomControlDependencies, lookup: RoomVideoLookup, userId: number, roomName: string, request: RoomVideoRequest,
  picks: RoomVideoPicks = roomVideoPicks,
): Promise<RoomControlResult> {
  if (!dependencies.skills.video) throw new RoomControlError("The video skill isn't configured.");
  const invocation = dependencies.invocations.video;
  if (!invocation) throw new RoomControlError("Set YTZERO_ALEXA_VIDEO_INVOCATION to the skill's invocation name first.");
  const devices = await dependencies.rooms.devices(userId);
  const room = await roomSpelling(devices, dependencies.settings, userId, roomName);
  const entity = await dependencies.settings.entity(userId, room);
  if (!entity) throw new RoomControlError(`The ${room} has no Home Assistant Echo yet.`);
  const command = await roomVideoCommand(invocation, request, lookup);
  // Noted before typing: the Echo can ask the skill before Home Assistant answers.
  if (request.kind === "video") picks.note(userId, room, request.videoId, command.replace(/^.*? to play the video /, ""));
  try {
    await dependencies.homeAssistant.typeCommand(entity, command);
  } catch (error) {
    throw new RoomControlError(error instanceof Error ? error.message : String(error), 502);
  }
  log.info("alexa.room_video_started", { room, kind: request.kind });
  return { room, entity, via: "typed", command };
}
