import { log } from "../logger";
import type { SearchResult } from "../youtube";
import { playDirective, playResponse, silent, speak, stopDirective, type AlexaResponse } from "./alexaPlayback";
import type { AlexaEnvelope } from "./alexaSkill";
import type { AlexaChannel, AlexaVideo } from "./alexaVideoCatalog";
import {
  bestMatch, CHANNEL_MATCH_MIN, channelScore, fromSplits, isoDurationSeconds, TITLE_MATCH_MIN, titleScore,
} from "./alexaVideoMatch";

/**
 * The video skill: "play <title> from <channel>" plays one video's audio.
 * The channel is matched against the channels the profile follows, then the
 * title against that channel's videos; anything else falls back to a YouTube
 * search. A video plays once and stops, and listening counts as watching.
 */
export interface AlexaVideoSkillDependencies {
  followedChannels: (userId: number) => Promise<AlexaChannel[]>;
  channelVideos: (userId: number, channelId: string) => Promise<AlexaVideo[]>;
  findVideo: (userId: number, videoId: string) => Promise<AlexaVideo | null>;
  search: (userId: number, query: string) => Promise<SearchResult[]>;
  /** Adds a searched-for video to the catalog, so it can be served and recorded. */
  importVideo: (userId: number, videoId: string) => Promise<void>;
  audioLink: (videoId: string, userId: number) => string;
  prepare: (userId: number, videoId: string) => void;
  recordStarted: (userId: number, videoId: string) => Promise<void>;
  recordProgress: (userId: number, videoId: string, position: number, duration: number | null) => Promise<void>;
  recordFinished: (userId: number, videoId: string) => Promise<void>;
}

const TOKEN_PREFIX = "yv1.";
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const DEFAULT_SKIP_SECONDS = 30;
const STARTED_LIMIT = 256;
const ASK = "Which video would you like to hear?";
const HELP = "You can say play, then a video's name from a channel you follow, like play how to fix a leaky faucet from This Old House. You can also say play the latest from a channel.";
const UNREACHABLE = "Sorry, I couldn't reach YouTube right now. Please try again in a moment.";

const STOP_INTENTS = new Set(["AMAZON.PauseIntent", "AMAZON.StopIntent", "AMAZON.CancelIntent"]);
const UNSUPPORTED_INTENTS = new Set([
  "AMAZON.PreviousIntent", "AMAZON.LoopOnIntent", "AMAZON.LoopOffIntent", "AMAZON.ShuffleOnIntent",
  "AMAZON.ShuffleOffIntent", "AMAZON.RepeatIntent",
]);

export const encodeVideoToken = (videoId: string) => TOKEN_PREFIX + videoId;
export function decodeVideoToken(token: unknown): string | null {
  if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX)) return null;
  const videoId = token.slice(TOKEN_PREFIX.length);
  return VIDEO_ID.test(videoId) ? videoId : null;
}

type Found = { video: AlexaVideo } | { message: string };

export function createAlexaVideoSkill(dependencies: AlexaVideoSkillDependencies) {
  // Tokens whose start was already recorded, so a pause and resume is one watch.
  const started = new Set<string>();

  async function fromSearch(userId: number, query: string, channelId?: string): Promise<AlexaVideo | null> {
    const results = await dependencies.search(userId, query);
    // A result with no duration is live or upcoming, which has no audio file to serve.
    const result = results.find((item) => item.duration && (!channelId || item.channelId === channelId));
    if (!result) return null;
    await dependencies.importVideo(userId, result.videoId);
    return dependencies.findVideo(userId, result.videoId);
  }

  async function matchedChannel(userId: number, spoken: string): Promise<AlexaChannel | null> {
    return bestMatch(spoken, await dependencies.followedChannels(userId), (channel) => channel.title, channelScore, CHANNEL_MATCH_MIN)?.item ?? null;
  }

  async function findVideo(userId: number, query: string): Promise<Found> {
    // Of every "<title> from <channel>" reading, take the one whose channel matches best.
    const channels = await dependencies.followedChannels(userId);
    let best: { title: string; channel: AlexaChannel; score: number } | null = null;
    for (const split of fromSplits(query)) {
      const match = bestMatch(split.channel, channels, (channel) => channel.title, channelScore, CHANNEL_MATCH_MIN);
      if (match && (!best || match.score > best.score)) best = { title: split.title, channel: match.item, score: match.score };
    }
    if (best) {
      const videos = (await dependencies.channelVideos(userId, best.channel.channelId)).filter((video) => video.playable);
      const match = bestMatch(best.title, videos, (video) => video.title, titleScore, TITLE_MATCH_MIN);
      const video = match?.item ?? await fromSearch(userId, `${best.title} ${best.channel.title}`, best.channel.channelId);
      return video ? { video } : { message: `I couldn't find ${best.title} from ${best.channel.title}.` };
    }
    const video = await fromSearch(userId, query);
    return video ? { video } : { message: `I couldn't find a video called ${query}.` };
  }

  async function latestFrom(userId: number, spoken: string): Promise<Found> {
    const channel = await matchedChannel(userId, spoken);
    if (!channel) return { message: `You don't follow a channel called ${spoken}.` };
    const video = (await dependencies.channelVideos(userId, channel.channelId)).find((item) => item.playable && !item.isShort);
    return video ? { video } : { message: `I couldn't find a recent video from ${channel.title}.` };
  }

  function play(userId: number, video: AlexaVideo, offsetSeconds: number, speech?: string | null): AlexaResponse {
    dependencies.prepare(userId, video.videoId);
    const directive = playDirective({
      track: { videoId: video.videoId, title: video.title, artist: video.channelTitle, thumbnail: video.thumbnail },
      url: dependencies.audioLink(video.videoId, userId),
      token: encodeVideoToken(video.videoId),
      behavior: "REPLACE_ALL",
      offsetInMilliseconds: offsetSeconds * 1000,
    });
    return speech === undefined ? silent([directive]) : playResponse(speech, directive);
  }

  async function start(userId: number, found: Found): Promise<AlexaResponse> {
    if ("message" in found) return speak(found.message, ASK);
    const { video } = found;
    if (!video.playable) return speak(`${video.title} can't be played as audio right now.`);
    const intro = video.resumeAt
      ? `Resuming ${video.title} from ${video.channelTitle}, where you left off.`
      : `Playing ${video.title} from ${video.channelTitle}.`;
    return play(userId, video, video.resumeAt ?? 0, intro);
  }

  /** The video Alexa is playing, at the position it reports. */
  async function current(userId: number, envelope: AlexaEnvelope): Promise<{ video: AlexaVideo; offset: number } | null> {
    const player = envelope.context?.AudioPlayer;
    const videoId = decodeVideoToken(player?.token);
    const video = videoId ? await dependencies.findVideo(userId, videoId) : null;
    return video ? { video, offset: Math.max(0, Math.floor((player?.offsetInMilliseconds ?? 0) / 1000)) } : null;
  }

  async function seek(userId: number, envelope: AlexaEnvelope, change: number | "start" | "same", speech: boolean): Promise<AlexaResponse> {
    const playing = await current(userId, envelope);
    if (!playing) return speech ? speak(`Nothing is playing. ${ASK}`, ASK) : silent();
    const target = change === "start" ? 0 : change === "same" ? playing.offset : playing.offset + change;
    const limit = playing.video.duration ? Math.max(0, playing.video.duration - 1) : Number.POSITIVE_INFINITY;
    return play(userId, playing.video, Math.min(Math.max(0, target), limit));
  }

  function skipAmount(envelope: AlexaEnvelope): number {
    return isoDurationSeconds(envelope.request?.intent?.slots?.duration?.value) ?? DEFAULT_SKIP_SECONDS;
  }

  async function audioEvent(userId: number, envelope: AlexaEnvelope, type: string): Promise<AlexaResponse> {
    const token = envelope.request?.token;
    const videoId = decodeVideoToken(token);
    if (!videoId || !token) return silent();
    const position = Math.max(0, Math.round((Number(envelope.request?.offsetInMilliseconds) || 0) / 1000));
    if (type === "AudioPlayer.PlaybackStarted") {
      if (!started.has(token)) {
        started.add(token);
        while (started.size > STARTED_LIMIT) started.delete(started.values().next().value!);
        await dependencies.recordStarted(userId, videoId);
      }
    } else if (type === "AudioPlayer.PlaybackStopped") {
      const video = await dependencies.findVideo(userId, videoId);
      await dependencies.recordProgress(userId, videoId, position, video?.duration ?? null);
    } else if (type === "AudioPlayer.PlaybackFinished") {
      started.delete(token);
      await dependencies.recordFinished(userId, videoId);
    } else if (type === "AudioPlayer.PlaybackFailed") {
      log.warn("alexa.playback_failed", { skill: "video", error: envelope.request?.error?.type, message: envelope.request?.error?.message });
    }
    return silent();
  }

  async function intent(userId: number, envelope: AlexaEnvelope): Promise<AlexaResponse> {
    const name = envelope.request?.intent?.name ?? "";
    const query = envelope.request?.intent?.slots?.query?.value?.trim().slice(0, 200) ?? "";
    if (name === "PlayVideoIntent") return query ? start(userId, await findVideo(userId, query)) : speak(ASK, HELP);
    if (name === "PlayLatestIntent") return query ? start(userId, await latestFrom(userId, query)) : speak("Which channel?", ASK);
    if (name === "SkipForwardIntent") return seek(userId, envelope, skipAmount(envelope), true);
    if (name === "SkipBackIntent") return seek(userId, envelope, -skipAmount(envelope), true);
    if (STOP_INTENTS.has(name)) return silent([stopDirective]);
    if (name === "AMAZON.ResumeIntent") return seek(userId, envelope, "same", true);
    if (name === "AMAZON.StartOverIntent") return seek(userId, envelope, "start", true);
    if (name === "AMAZON.NextIntent") return speak("There's nothing queued after this video.");
    if (UNSUPPORTED_INTENTS.has(name)) return speak("Sorry, YT Zero can't do that yet.");
    return speak(HELP, ASK);
  }

  async function controller(userId: number, envelope: AlexaEnvelope, type: string): Promise<AlexaResponse> {
    if (type === "PlaybackController.PauseCommandIssued") return silent([stopDirective]);
    if (type === "PlaybackController.PlayCommandIssued") return seek(userId, envelope, "same", false);
    return silent();
  }

  async function handle(userId: number, envelope: AlexaEnvelope): Promise<AlexaResponse> {
    const type = envelope.request?.type ?? "";
    try {
      if (type === "LaunchRequest") return speak(ASK, HELP);
      if (type === "IntentRequest") return await intent(userId, envelope);
      if (type.startsWith("AudioPlayer.")) return await audioEvent(userId, envelope, type);
      if (type.startsWith("PlaybackController.")) return await controller(userId, envelope, type);
      if (type === "System.ExceptionEncountered") {
        log.warn("alexa.exception", { skill: "video", error: envelope.request?.error?.type, message: envelope.request?.error?.message });
      }
      return silent();
    } catch (error) {
      log.warn("alexa.request_failed", { skill: "video", type, error: error instanceof Error ? error.message : String(error) });
      return type === "IntentRequest" || type === "LaunchRequest" ? speak(UNREACHABLE) : silent();
    }
  }

  return { handle };
}

export type AlexaVideoSkill = ReturnType<typeof createAlexaVideoSkill>;
