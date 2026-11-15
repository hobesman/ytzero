import { log } from "../logger";
import type { SearchResult } from "../youtube";
import { createChannelDialog, type ChannelDialogDependencies } from "./alexaChannelDialog";
import { playDirective, playResponse, silent, speak, stopDirective, type AlexaResponse } from "./alexaPlayback";
import type { AlexaEnvelope } from "./alexaSkill";
import type { AlexaChannel, AlexaVideo } from "./alexaVideoCatalog";
import {
  bestMatch, CHANNEL_MATCH_MIN, channelScore, fromSplits, isoDurationSeconds, TITLE_MATCH_MIN, titleScore,
} from "./alexaVideoMatch";
import { decodeShuffleToken, encodeShuffleToken, pickRandomVideo, shuffleAfter, type VideoShuffle } from "./alexaVideoShuffle";

/**
 * The video skill: "play <title> from <channel>" plays one video's audio.
 * The channel is matched against the channels the profile follows, then the
 * title against that channel's videos; anything else falls back to a YouTube
 * search. A video plays once and stops, unless the channel is shuffled, and
 * listening counts as watching.
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
  /** Following and unfollowing by voice; left out, those intents say they aren't available. */
  channels?: ChannelDialogDependencies;
}

const TOKEN_PREFIX = "yv1.";
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const DEFAULT_SKIP_SECONDS = 30;
const STARTED_LIMIT = 256;
const ASK = "Which video would you like to hear?";
const HELP = "You can say play, then a video's name from a channel you follow, like play how to fix a leaky faucet from This Old House. You can also say play the latest from a channel, shuffle a channel, or find the channel, then a name, to follow it.";
const UNREACHABLE = "Sorry, I couldn't reach YouTube right now. Please try again in a moment.";

const STOP_INTENTS = new Set(["AMAZON.PauseIntent", "AMAZON.StopIntent", "AMAZON.CancelIntent"]);
const UNSUPPORTED_INTENTS = new Set([
  "AMAZON.PreviousIntent", "AMAZON.LoopOnIntent", "AMAZON.LoopOffIntent", "AMAZON.ShuffleOnIntent",
  "AMAZON.ShuffleOffIntent", "AMAZON.RepeatIntent",
]);

export const encodeVideoToken = (videoId: string) => TOKEN_PREFIX + videoId;
export function decodeVideoToken(token: unknown): string | null {
  const shuffle = decodeShuffleToken(token);
  if (shuffle) return shuffle.videoId;
  if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX)) return null;
  const videoId = token.slice(TOKEN_PREFIX.length);
  return VIDEO_ID.test(videoId) ? videoId : null;
}

type Found = { video: AlexaVideo; shuffle?: VideoShuffle } | { message: string };

/** "the channel mark rober" names the channel "mark rober". */
const channelPhrase = (spoken: string) => spoken.replace(/^(the\s+)?channel\s+/i, "").trim();

export function createAlexaVideoSkill(dependencies: AlexaVideoSkillDependencies) {
  // Tokens whose start was already recorded, so a pause and resume is one watch.
  const started = new Set<string>();
  const dialog = dependencies.channels ? createChannelDialog(dependencies.channels) : null;

  /** The channel of the video Alexa is playing (or paused on). */
  async function playingChannel(userId: number, envelope: AlexaEnvelope) {
    const videoId = decodeVideoToken(envelope.context?.AudioPlayer?.token);
    const video = videoId ? await dependencies.findVideo(userId, videoId) : null;
    return video ? { channelId: video.channelId, title: video.channelTitle } : null;
  }

  async function channelIntent(userId: number, envelope: AlexaEnvelope, name: string, query: string): Promise<AlexaResponse | null> {
    if (!dialog) return null;
    // "Follow this channel" can be heard as a search for "this channel".
    const current = !query || /^(this|the|that)( channel| one)?$/i.test(query) || /^this (channel|video)/i.test(query);
    if (name === "FindChannelIntent") return current ? dialog.followChannel(userId, await playingChannel(userId, envelope)) : dialog.find(userId, query);
    if (name === "FollowCurrentIntent") return dialog.followChannel(userId, await playingChannel(userId, envelope));
    if (name === "UnfollowChannelIntent") return current ? dialog.unfollowChannel(userId, await playingChannel(userId, envelope)) : dialog.unfollow(userId, query);
    if (name === "UnfollowCurrentIntent") return dialog.unfollowChannel(userId, await playingChannel(userId, envelope));
    if (name === "AMAZON.YesIntent" || name === "AMAZON.NoIntent") return dialog.answer(userId, envelope.session?.attributes, name === "AMAZON.YesIntent");
    return null;
  }

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

  async function randomFrom(userId: number, spoken: string, shuffle: boolean): Promise<Found> {
    const name = channelPhrase(spoken);
    const channel = await matchedChannel(userId, name);
    if (!channel) return { message: `You don't follow a channel called ${name}.` };
    const video = pickRandomVideo(await dependencies.channelVideos(userId, channel.channelId), []);
    if (!video) return { message: `I couldn't find a video from ${channel.title}.` };
    return { video, ...(shuffle ? { shuffle: { channelId: channel.channelId, videoId: video.videoId, played: [] } } : {}) };
  }

  /** The next shuffled video after the one in `state`, or null. */
  async function nextShuffled(userId: number, state: VideoShuffle): Promise<{ video: AlexaVideo; state: VideoShuffle } | null> {
    const played = [...state.played, state.videoId];
    const video = pickRandomVideo(await dependencies.channelVideos(userId, state.channelId), played);
    return video ? { video, state: shuffleAfter(state, video.videoId) } : null;
  }

  async function latestFrom(userId: number, said: string): Promise<Found> {
    const spoken = channelPhrase(said);
    const channel = await matchedChannel(userId, spoken);
    if (!channel) return { message: `You don't follow a channel called ${spoken}.` };
    const video = (await dependencies.channelVideos(userId, channel.channelId)).find((item) => item.playable && !item.isShort);
    return video ? { video } : { message: `I couldn't find a recent video from ${channel.title}.` };
  }

  function play(userId: number, video: AlexaVideo, offsetSeconds: number, speech?: string | null, queue: { token?: string; previousToken?: string } = {}): AlexaResponse {
    dependencies.prepare(userId, video.videoId);
    const directive = playDirective({
      track: { videoId: video.videoId, title: video.title, artist: video.channelTitle, thumbnail: video.thumbnail },
      url: dependencies.audioLink(video.videoId, userId),
      token: queue.token ?? encodeVideoToken(video.videoId),
      behavior: queue.previousToken ? "ENQUEUE" : "REPLACE_ALL",
      offsetInMilliseconds: offsetSeconds * 1000,
      expectedPreviousToken: queue.previousToken,
    });
    return speech === undefined ? silent([directive]) : playResponse(speech, directive);
  }

  async function start(userId: number, found: Found): Promise<AlexaResponse> {
    if ("message" in found) return speak(found.message, ASK);
    const { video } = found;
    if (!video.playable) return speak(`${video.title} can't be played as audio right now.`);
    const intro = found.shuffle
      ? `Shuffling ${video.channelTitle}, starting with ${video.title}.`
      : video.resumeAt
        ? `Resuming ${video.title} from ${video.channelTitle}, where you left off.`
        : `Playing ${video.title} from ${video.channelTitle}.`;
    return play(userId, video, video.resumeAt ?? 0, intro, { token: found.shuffle ? encodeShuffleToken(found.shuffle) : undefined });
  }

  /** The video Alexa is playing, at the position it reports. */
  async function current(userId: number, envelope: AlexaEnvelope): Promise<{ video: AlexaVideo; offset: number; token: string } | null> {
    const player = envelope.context?.AudioPlayer;
    const videoId = decodeVideoToken(player?.token);
    const video = videoId ? await dependencies.findVideo(userId, videoId) : null;
    return video && player?.token ? { video, offset: Math.max(0, Math.floor((player.offsetInMilliseconds ?? 0) / 1000)), token: player.token } : null;
  }

  /** Next, in a shuffle: another random video from the channel. */
  async function skipShuffled(userId: number, token: string | undefined, speech: boolean): Promise<AlexaResponse> {
    const state = decodeShuffleToken(token);
    if (!state) return speech ? speak("There's nothing queued after this video.") : silent();
    const next = await nextShuffled(userId, state);
    if (!next) return speech ? speak("That's every video from this channel.") : silent([stopDirective]);
    return play(userId, next.video, next.video.resumeAt ?? 0, undefined, { token: encodeShuffleToken(next.state) });
  }

  async function seek(userId: number, envelope: AlexaEnvelope, change: number | "start" | "same", speech: boolean): Promise<AlexaResponse> {
    const playing = await current(userId, envelope);
    if (!playing) return speech ? speak(`Nothing is playing. ${ASK}`, ASK) : silent();
    const target = change === "start" ? 0 : change === "same" ? playing.offset : playing.offset + change;
    const limit = playing.video.duration ? Math.max(0, playing.video.duration - 1) : Number.POSITIVE_INFINITY;
    return play(userId, playing.video, Math.min(Math.max(0, target), limit), undefined, { token: playing.token });
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
    } else if (type === "AudioPlayer.PlaybackNearlyFinished") {
      const state = decodeShuffleToken(token);
      const next = state ? await nextShuffled(userId, state) : null;
      if (next) return play(userId, next.video, next.video.resumeAt ?? 0, undefined, { token: encodeShuffleToken(next.state), previousToken: token });
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
    if (name === "ShuffleChannelIntent" || name === "RandomVideoIntent") {
      return query ? start(userId, await randomFrom(userId, query, name === "ShuffleChannelIntent")) : speak("Which channel?", ASK);
    }
    const channelAnswer = await channelIntent(userId, envelope, name, query);
    if (channelAnswer) return channelAnswer;
    if (name === "AMAZON.NoIntent") return speak("Okay.");
    if (name === "SkipForwardIntent") return seek(userId, envelope, skipAmount(envelope), true);
    if (name === "SkipBackIntent") return seek(userId, envelope, -skipAmount(envelope), true);
    if (STOP_INTENTS.has(name)) return silent([stopDirective]);
    if (name === "AMAZON.ResumeIntent") return seek(userId, envelope, "same", true);
    if (name === "AMAZON.StartOverIntent") return seek(userId, envelope, "start", true);
    if (name === "AMAZON.NextIntent") return skipShuffled(userId, envelope.context?.AudioPlayer?.token, true);
    if (UNSUPPORTED_INTENTS.has(name)) return speak("Sorry, YT Zero can't do that yet.");
    return speak(HELP, ASK);
  }

  async function controller(userId: number, envelope: AlexaEnvelope, type: string): Promise<AlexaResponse> {
    if (type === "PlaybackController.PauseCommandIssued") return silent([stopDirective]);
    if (type === "PlaybackController.NextCommandIssued") return skipShuffled(userId, envelope.context?.AudioPlayer?.token, false);
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
