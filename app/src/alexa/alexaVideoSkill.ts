import { log } from "../logger";
import type { SearchResult } from "../youtube";
import { createChannelDialog, type ChannelDialogDependencies } from "./alexaChannelDialog";
import { playDirective, playResponse, silent, speak, stopDirective, type AlexaResponse } from "./alexaPlayback";
import type { RoomVideoPickKind } from "./alexaRoomVideoPicks";
import { envelopeDeviceId, type AlexaEnvelope } from "./alexaSkill";
import type { AlexaChannel, AlexaVideo } from "./alexaVideoCatalog";
import {
  bestMatch, CHANNEL_MATCH_MIN, channelScore, fromSplits, isoDurationSeconds, TITLE_MATCH_MIN, titleScore,
} from "./alexaVideoMatch";
import { decodeShuffleToken, encodeShuffleToken, pickRandomVideo, shuffleAfter, type VideoShuffle } from "./alexaVideoShuffle";
import { withoutStreamStart } from "./alexaStreamTokens";

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
  /** The stream for a video, starting `offsetSeconds` in. */
  audioLink: (videoId: string, userId: number, offsetSeconds: number) => string;
  /**
   * Where a stream asked to start at `offsetSeconds` really starts. An Echo
   * plays a stream from its own start whatever offset it is given, and reports
   * that offset back plus the time played, so the stream starts at a segment
   * boundary and the offset sent is that boundary. Without it, the offset as is.
   */
  streamStart?: (userId: number, videoId: string, offsetSeconds: number) => Promise<number>;
  prepare: (userId: number, videoId: string) => void;
  recordStarted: (userId: number, videoId: string) => Promise<void>;
  recordProgress: (userId: number, videoId: string, position: number, duration: number | null) => Promise<void>;
  recordFinished: (userId: number, videoId: string) => Promise<void>;
  /**
   * Videos to resume when the Echo holds none of ours, most likely first: the
   * last one this device played, then the profile's latest unfinished one.
   */
  resumeCandidates?: (userId: number, deviceId: string | undefined) => Promise<string[]>;
  /** Following and unfollowing by voice; left out, those intents say they aren't available. */
  channels?: ChannelDialogDependencies;
  /**
   * The exact video a room screen just asked this Echo for, when the words
   * Alexa heard are the ones it typed; used once. See alexaRoomVideoPicks.
   */
  roomPick?: (userId: number, deviceId: string, heard: string, kind: RoomVideoPickKind) => Promise<string | null>;
}

const TOKEN_PREFIX = "yv1.";
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const DEFAULT_SKIP_SECONDS = 30;
// A stream reported finished further than this from the video's end broke off early.
const FINISHED_MARGIN_SECONDS = 60;
const STARTED_LIMIT = 256;
const ASK = "Which video would you like to hear?";
const HELP = "You can say play, then a video's name from a channel you follow, like play how to fix a leaky faucet from This Old House. You can also say play the latest from a channel, shuffle a channel, or find the channel, then a name, to follow it.";
const UNREACHABLE = "Sorry, I couldn't reach YouTube right now. Please try again in a moment.";

const STOP_INTENTS = new Set(["AMAZON.PauseIntent", "AMAZON.StopIntent", "AMAZON.CancelIntent"]);
const UNSUPPORTED_INTENTS = new Set([
  "AMAZON.LoopOnIntent", "AMAZON.LoopOffIntent", "AMAZON.ShuffleOnIntent",
  "AMAZON.ShuffleOffIntent", "AMAZON.RepeatIntent",
]);

export const encodeVideoToken = (videoId: string) => TOKEN_PREFIX + videoId;
export function decodeVideoToken(given: unknown): string | null {
  const token = typeof given === "string" ? withoutStreamStart(given) : given;
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

  /** The video the room's screen asked for, added to the catalog if it's new: no search, no guessing the channel. */
  async function pickedVideo(userId: number, envelope: AlexaEnvelope, query: string): Promise<Found | null> {
    const deviceId = envelopeDeviceId(envelope);
    const videoId = deviceId ? await dependencies.roomPick?.(userId, deviceId, query, "video") : null;
    if (!videoId) return null;
    try {
      await dependencies.importVideo(userId, videoId);
    } catch (error) {
      log.warn("alexa.room_pick_import_failed", { videoId, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
    const video = await dependencies.findVideo(userId, videoId);
    return video ? { video } : null;
  }

  /** The followed channel the room's screen asked for the latest from or a shuffle of, rather than the one whose name sounds closest. */
  async function pickedChannel(userId: number, envelope: AlexaEnvelope, query: string, kind: "latest" | "shuffle"): Promise<AlexaChannel | null> {
    const deviceId = envelopeDeviceId(envelope);
    const channelId = deviceId ? await dependencies.roomPick?.(userId, deviceId, channelPhrase(query), kind) : null;
    return channelId ? (await dependencies.followedChannels(userId)).find((channel) => channel.channelId === channelId) ?? null : null;
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

  async function randomFrom(userId: number, spoken: string, shuffle: boolean, picked: AlexaChannel | null = null): Promise<Found> {
    const name = channelPhrase(spoken);
    const channel = picked ?? await matchedChannel(userId, name);
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

  async function latestFrom(userId: number, said: string, picked: AlexaChannel | null = null): Promise<Found> {
    const spoken = channelPhrase(said);
    const channel = picked ?? await matchedChannel(userId, spoken);
    if (!channel) return { message: `You don't follow a channel called ${spoken}.` };
    const video = (await dependencies.channelVideos(userId, channel.channelId)).find((item) => item.playable && !item.isShort);
    return video ? { video } : { message: `I couldn't find a recent video from ${channel.title}.` };
  }

  async function play(userId: number, video: AlexaVideo, offsetSeconds: number, speech?: string | null, queue: { token?: string; previousToken?: string } = {}): Promise<AlexaResponse> {
    dependencies.prepare(userId, video.videoId);
    const start = offsetSeconds > 0 && dependencies.streamStart ? await dependencies.streamStart(userId, video.videoId, offsetSeconds) : offsetSeconds;
    const directive = playDirective({
      track: { videoId: video.videoId, title: video.title, artist: video.channelTitle, thumbnail: video.thumbnail },
      url: dependencies.audioLink(video.videoId, userId, start),
      token: queue.token ?? encodeVideoToken(video.videoId),
      behavior: queue.previousToken ? "ENQUEUE" : "REPLACE_ALL",
      offsetInMilliseconds: start * 1000,
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

  /**
   * Resuming when the Echo no longer holds a video of ours (other audio
   * played since, say): the last unfinished video this Echo or the profile
   * played, from where it stopped.
   */
  async function resumeLast(userId: number, envelope: AlexaEnvelope, speech: boolean): Promise<AlexaResponse | null> {
    for (const videoId of await dependencies.resumeCandidates?.(userId, envelopeDeviceId(envelope)) ?? []) {
      const video = await dependencies.findVideo(userId, videoId);
      if (!video?.playable || video.watched) continue;
      const intro = video.resumeAt
        ? `Resuming ${video.title} from ${video.channelTitle}, where you left off.`
        : `Playing ${video.title} from ${video.channelTitle}.`;
      return play(userId, video, video.resumeAt ?? 0, speech ? intro : undefined);
    }
    return null;
  }

  async function seek(userId: number, envelope: AlexaEnvelope, change: number | "start" | "same" | { to: number }, speech: boolean): Promise<AlexaResponse> {
    const playing = await current(userId, envelope);
    if (!playing && change === "same") {
      const resumed = await resumeLast(userId, envelope, speech);
      if (resumed) return resumed;
    }
    if (!playing) return speech ? speak(`Nothing is playing. ${ASK}`, ASK) : silent();
    // Resuming goes on from the profile's latest saved place, not the Echo's:
    // the video may have played further on another Echo or in the app since.
    const target = change === "start" ? 0
      : change === "same" ? playing.video.resumeAt ?? playing.offset
      : typeof change === "object" ? change.to
      : playing.offset + change;
    const limit = playing.video.duration ? Math.max(0, playing.video.duration - 1) : Number.POSITIVE_INFINITY;
    return play(userId, playing.video, Math.min(Math.max(0, target), limit), undefined, { token: playing.token });
  }

  /** Previous, in a shuffle: the video before this one, from its start. Otherwise this video starts over. */
  async function previous(userId: number, envelope: AlexaEnvelope, speech: boolean): Promise<AlexaResponse> {
    const state = decodeShuffleToken(envelope.context?.AudioPlayer?.token);
    const before = state?.played.at(-1);
    const video = state && before ? await dependencies.findVideo(userId, before) : null;
    if (!state || !video?.playable) return seek(userId, envelope, "start", speech);
    return play(userId, video, 0, undefined, { token: encodeShuffleToken({ channelId: state.channelId, videoId: video.videoId, played: state.played.slice(0, -1) }) });
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
      // A stream that ends well before the video does broke off: keep the
      // place instead of marking it watched, which would make every later
      // play start over.
      const video = await dependencies.findVideo(userId, videoId);
      if (video?.duration && position < video.duration - FINISHED_MARGIN_SECONDS) {
        log.warn("alexa.video_ended_early", { videoId, position, duration: video.duration });
        await dependencies.recordProgress(userId, videoId, position, video.duration);
      } else {
        await dependencies.recordFinished(userId, videoId);
      }
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
    if (name === "PlayVideoIntent") {
      if (!query) return speak(ASK, HELP);
      return start(userId, await pickedVideo(userId, envelope, query) ?? await findVideo(userId, query));
    }
    if (name === "PlayLatestIntent") {
      return query ? start(userId, await latestFrom(userId, query, await pickedChannel(userId, envelope, query, "latest"))) : speak("Which channel?", ASK);
    }
    if (name === "ShuffleChannelIntent" || name === "RandomVideoIntent") {
      const shuffle = name === "ShuffleChannelIntent";
      const picked = shuffle && query ? await pickedChannel(userId, envelope, query, "shuffle") : null;
      return query ? start(userId, await randomFrom(userId, query, shuffle, picked)) : speak("Which channel?", ASK);
    }
    const channelAnswer = await channelIntent(userId, envelope, name, query);
    if (channelAnswer) return channelAnswer;
    if (name === "AMAZON.NoIntent") return speak("Okay.");
    if (name === "SkipForwardIntent") return seek(userId, envelope, skipAmount(envelope), true);
    if (name === "SkipBackIntent") return seek(userId, envelope, -skipAmount(envelope), true);
    if (name === "SeekToIntent") {
      const to = isoDurationSeconds(envelope.request?.intent?.slots?.position?.value);
      return to === null ? speak("Where in the video? Say, for example, jump to 5 minutes.") : seek(userId, envelope, { to }, true);
    }
    if (name === "AMAZON.PreviousIntent") return previous(userId, envelope, true);
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
    if (type === "PlaybackController.PreviousCommandIssued") return previous(userId, envelope, false);
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
