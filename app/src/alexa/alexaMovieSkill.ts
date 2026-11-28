import { isPlexId, type PlexChapter, type PlexClient, type PlexItem, type PlexSummary } from "../plex/plexClient";
import { log } from "../logger";
import { spokenDuration } from "./alexaBookMath";
import { playResponse, silent, speak, stopDirective, type AlexaResponse } from "./alexaPlayback";
import { envelopeDeviceId, type AlexaEnvelope } from "./alexaSkill";
import { withoutStreamStart } from "./alexaStreamTokens";
import { bestMatch, isoDurationSeconds, TITLE_MATCH_MIN, titleScore } from "./alexaVideoMatch";

/**
 * Hoban Plex: the soundtrack of the movies and shows in the user's Plex
 * server, on an Echo. The place is kept in Plex itself, so the TV carries on
 * from where the kitchen stopped and the other way round. A show plays on
 * into its next episode; a title played to its end is marked watched.
 */
export type MovieApi = Pick<PlexClient, "search" | "item" | "episodes" | "onDeck" | "saveProgress" | "markWatched">;

export interface AlexaMovieSkillDependencies {
  /** Plex, or why it isn't there. */
  plex: () => MovieApi | { disabled: string };
  /** The stream for a title from `startSeconds`. */
  audioLink: (itemId: string, userId: number, startSeconds: number) => string;
  /** A poster the Echo's screen can fetch. */
  posterLink: (itemId: string) => string;
  /** The room this Echo is paired with, and the title its tablet just picked there (see alexaRoomPlexPicks.ts). */
  roomPick?: (userId: number, deviceId: string) => Promise<{ room: string | null; pick: { itemId: string; startSeconds: number | null } | null }>;
  now?: () => number;
}

const TOKEN_PREFIX = "pm1.";
export const MOVIE_PROGRESS_REPORT_MS = 60_000;
const DEFAULT_SKIP_SECONDS = 30;
const REPLACED_STREAM_GRACE_MS = 8_000;
const ITEM_CACHE_MS = 2 * 60_000;
const ITEM_CACHE_LIMIT = 32;
/** A place this close to the start isn't worth resuming from. */
const RESUME_MIN_SECONDS = 30;

const ASK = "What would you like to listen to? Say continue watching, or a movie or show.";
const HELP = "You can say continue watching, play a movie's title, play a show to carry on with it, or play a show, season 2, episode 4. While it plays, say next or previous, skip back thirty seconds, what's playing, or how much is left.";
const UNREACHABLE = "Sorry, I couldn't reach Plex right now. Please try again in a moment.";
const STOP_INTENTS = new Set(["AMAZON.PauseIntent", "AMAZON.StopIntent", "AMAZON.CancelIntent"]);
const UNSUPPORTED_INTENTS = new Set([
  "AMAZON.LoopOnIntent", "AMAZON.LoopOffIntent", "AMAZON.ShuffleOnIntent", "AMAZON.ShuffleOffIntent", "AMAZON.RepeatIntent",
]);

export const encodeMovieToken = (itemId: string) => `${TOKEN_PREFIX}${itemId}`;
export function decodeMovieToken(given: unknown): string | null {
  const token = typeof given === "string" ? withoutStreamStart(given) : given;
  if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX)) return null;
  const id = token.slice(TOKEN_PREFIX.length);
  return isPlexId(id) ? id : null;
}

/** How close to the end counts as watched: the credits, or the last 5%, whichever is longer, up to ten minutes. */
export function watchedFrom(duration: number): number {
  return duration - Math.min(600, Math.max(120, duration * 0.05));
}

/** Where a title should start: its saved place, unless watched, barely started or in the credits. */
export function movieResumePosition(item: Pick<PlexItem, "duration" | "viewOffset" | "watched">): number {
  if (item.watched || item.viewOffset < RESUME_MIN_SECONDS || item.viewOffset >= watchedFrom(item.duration)) return 0;
  return item.viewOffset;
}

/** The episode to carry on with: the one part way through, else the one after the latest watched, else the first. */
export function nextUp(episodes: readonly PlexItem[]): PlexItem | null {
  const started = episodes.filter((episode) => !episode.watched && movieResumePosition(episode) > 0)
    .sort((a, b) => b.lastViewedAt - a.lastViewedAt)[0];
  if (started) return started;
  let lastWatched = -1;
  episodes.forEach((episode, index) => { if (episode.watched) lastWatched = index; });
  return episodes.slice(lastWatched + 1).find((episode) => !episode.watched) ?? episodes.find((episode) => !episode.watched) ?? episodes[0] ?? null;
}

/** "The Office, season 2, episode 4: The Fire", or a movie's title. */
export function spokenTitle(item: Pick<PlexItem, "type" | "title" | "show" | "season" | "episode">): string {
  if (item.type !== "episode" || !item.show) return item.title;
  const number = [item.season ? `season ${item.season}` : "", item.episode ? `episode ${item.episode}` : ""].filter(Boolean).join(", ");
  return `${item.show.title}${number ? `, ${number}` : ""}: ${item.title}`;
}

export function movieSubtitle(item: Pick<PlexItem, "type" | "title" | "show" | "season" | "episode" | "year">): string {
  if (item.type === "episode") return [item.show?.title, item.season && item.episode ? `S${item.season} · E${item.episode}` : null].filter(Boolean).join(" · ");
  return item.year ? String(item.year) : "Movie";
}

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
  "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "twenty one", "twenty two", "twenty three", "twenty four", "twenty five",
];
const spokenNumber = (value: string): number | null => {
  const word = value.trim().toLowerCase().replace(/-/g, " ");
  if (/^\d{1,3}$/.test(word)) return Number(word);
  const index = NUMBER_WORDS.indexOf(word);
  return index >= 0 ? index : null;
};
const NUMBER = "(\\d{1,3}|(?:twenty[ -])?[a-z]+)";
const SEASON_EPISODE = new RegExp(`^(.*?)[,\\s]+season ${NUMBER}(?:[,\\s]+(?:and )?episode ${NUMBER})?$`, "i");
const SHORT_FORM = /^(.*?)[,\s]+s(\d{1,3}) ?e(\d{1,3})$/i;

/**
 * "The Office season 2 episode 4", "the office, season two", "the office s2e4":
 * the show and the numbers, or null for a plain title. An Alexa utterance
 * can't hold a search phrase and a number slot together, so this comes in
 * as one phrase.
 */
export function parseEpisodeRequest(query: string): { show: string; season: number; episode: number | null } | null {
  const short = query.trim().match(SHORT_FORM);
  if (short?.[1]) return { show: short[1].trim(), season: Number(short[2]), episode: Number(short[3]) };
  const match = query.trim().match(SEASON_EPISODE);
  if (!match?.[1]) return null;
  const season = spokenNumber(match[2]!);
  const episode = match[3] ? spokenNumber(match[3]) : null;
  if (season === null || (match[3] && episode === null)) return null;
  return { show: match[1].trim(), season, episode };
}

function chapterAt(chapters: readonly PlexChapter[], position: number): number {
  let found = -1;
  chapters.forEach((chapter, index) => { if (chapter.start <= position + 0.5) found = index; });
  return found;
}

class Unavailable extends Error {}

export function createAlexaMovieSkill(dependencies: AlexaMovieSkillDependencies) {
  const now = dependencies.now ?? Date.now;
  const cache = new Map<string, { item: PlexItem; at: number }>();
  const lastPlay = new Map<string, number>();

  const api = (): MovieApi => {
    const plex = dependencies.plex();
    if ("disabled" in plex) throw new Unavailable(plex.disabled);
    return plex;
  };

  async function item(itemId: string): Promise<PlexItem | null> {
    const cached = cache.get(itemId);
    if (cached && now() - cached.at < ITEM_CACHE_MS) return cached.item;
    const found = await api().item(itemId);
    if (found) {
      cache.set(itemId, { item: found, at: now() });
      while (cache.size > ITEM_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    }
    return found;
  }

  /** The cached copy is out of date once the place moves; the next look reads Plex again. */
  const forget = (itemId: string) => cache.delete(itemId);

  async function save(found: PlexItem, position: number, reason: string, state: "playing" | "paused" | "stopped" = "stopped"): Promise<void> {
    try {
      forget(found.id);
      if (position >= watchedFrom(found.duration)) await api().markWatched(found.id);
      else await api().saveProgress(found.id, position, state);
    } catch (error) {
      log.warn("alexa.movie_progress_failed", { itemId: found.id, reason, error: error instanceof Error ? error.message : String(error) });
    }
  }

  function directive(found: PlexItem, position: number, behavior: "REPLACE_ALL" | "ENQUEUE", userId: number, previousToken?: string): Record<string, unknown> {
    const offset = Math.floor(Math.max(0, Math.min(position, found.duration - 1)));
    return {
      type: "AudioPlayer.Play",
      playBehavior: behavior,
      audioItem: {
        stream: {
          url: dependencies.audioLink(found.id, userId, offset),
          token: encodeMovieToken(found.id),
          // The stream itself starts here; see alexaMovieAudio.ts.
          offsetInMilliseconds: offset * 1000,
          ...(behavior === "ENQUEUE" && previousToken ? { expectedPreviousToken: previousToken } : {}),
          progressReport: { progressReportIntervalInMilliseconds: MOVIE_PROGRESS_REPORT_MS },
        },
        metadata: {
          title: found.title,
          subtitle: movieSubtitle(found),
          art: { sources: [{ url: dependencies.posterLink(found.id) }] },
        },
      },
    };
  }

  async function play(userId: number, found: PlexItem, position: number, speech?: string | null): Promise<AlexaResponse> {
    const start = Math.floor(Math.max(0, Math.min(position, found.duration - 1)));
    lastPlay.set(found.id, now());
    if (start > 0) await save(found, start, "play", "paused");
    const play = directive(found, start, "REPLACE_ALL", userId);
    return speech === undefined ? silent([play]) : playResponse(speech, play);
  }

  const intro = (found: PlexItem, position: number) => `${position > 0 ? "Resuming" : "Playing"} ${spokenTitle(found)}.`;

  /** Plays a title from its saved place in Plex. */
  async function playSaved(userId: number, found: PlexItem, speech = true): Promise<AlexaResponse> {
    const position = movieResumePosition(found);
    return play(userId, found, position, speech ? intro(found, position) : undefined);
  }

  /** The title the Echo is playing or paused on, and the place it reports. */
  async function current(envelope: AlexaEnvelope): Promise<{ item: PlexItem; position: number; token: string } | null> {
    const player = envelope.context?.AudioPlayer;
    const itemId = decodeMovieToken(player?.token);
    const found = itemId ? await item(itemId) : null;
    if (!found || !player?.token) return null;
    return { item: found, position: Math.max(0, (player.offsetInMilliseconds ?? 0) / 1000), token: player.token };
  }

  async function showNextUp(showId: string): Promise<PlexItem | null> {
    const next = nextUp(await api().episodes(showId));
    return next ? item(next.id) : null;
  }

  /** The episode before or after one, in the show's order. */
  async function neighbour(found: PlexItem, step: 1 | -1): Promise<PlexItem | null> {
    if (!found.show) return null;
    const episodes = await api().episodes(found.show.id);
    const here = episodes.findIndex((episode) => episode.id === found.id);
    const other = here < 0 ? null : episodes[here + step];
    return other ? item(other.id) : null;
  }

  async function resumeLatest(userId: number, speech: boolean): Promise<AlexaResponse> {
    const deck = await api().onDeck(5);
    const latest = deck[0] ? await item(deck[0].id) : null;
    if (!latest) return speech ? speak("You don't have anything in progress. What would you like?", ASK) : silent();
    return playSaved(userId, latest, speech);
  }

  async function resume(userId: number, envelope: AlexaEnvelope, speech: boolean): Promise<AlexaResponse> {
    const playing = await current(envelope);
    if (!playing) return resumeLatest(userId, speech);
    forget(playing.item.id);
    const fresh = await item(playing.item.id) ?? playing.item;
    // Plex may know a later place, from the TV.
    const position = fresh.viewOffset > 0 && !fresh.watched ? fresh.viewOffset : playing.position;
    return play(userId, fresh, position, undefined);
  }

  function pick(query: string, results: PlexSummary[], types: readonly PlexSummary["type"][]): PlexSummary | null {
    const wanted = results.filter((result) => types.includes(result.type));
    const label = (result: PlexSummary) => result.type === "episode" && result.showTitle ? `${result.showTitle} ${result.title}` : result.title;
    return bestMatch(query, wanted, label, titleScore, TITLE_MATCH_MIN)?.item ?? wanted[0] ?? null;
  }

  /** "Play X": a movie from its place, a show from its next episode, an episode named outright. */
  async function playTitle(userId: number, query: string): Promise<AlexaResponse> {
    const spoken = query.replace(/^(the (movie|film|show|series) )/i, "").trim();
    const found = pick(spoken, await api().search(spoken), ["movie", "show", "episode"]);
    if (!found) return speak(`I couldn't find ${query} in Plex.`, ASK);
    if (found.type === "show") {
      const next = await showNextUp(found.id);
      return next ? playSaved(userId, next) : speak(`${found.title} has no episodes I can play.`);
    }
    const title = await item(found.id);
    return title ? playSaved(userId, title) : speak(`I couldn't play ${found.title}.`);
  }

  async function findShow(query: string): Promise<PlexSummary | null> {
    const spoken = query.replace(/^(the (show|series) )/i, "").trim();
    return pick(spoken, await api().search(spoken), ["show"]);
  }

  /** A named episode, or a season's first when no episode is given. */
  async function playEpisode(userId: number, request: { show: string; season: number; episode: number | null }): Promise<AlexaResponse> {
    const show = await findShow(request.show);
    if (!show) return speak(`I couldn't find a show called ${request.show}.`, ASK);
    const episodes = await api().episodes(show.id);
    const wanted = episodes.find((entry) => entry.season === request.season && (request.episode === null || entry.episode === request.episode));
    const asked = request.episode === null ? `season ${request.season}` : `season ${request.season}, episode ${request.episode}`;
    if (!wanted) return speak(`I couldn't find ${asked} of ${show.title}.`, ASK);
    const found = await item(wanted.id);
    return found ? playSaved(userId, found) : speak(`I couldn't play ${asked} of ${show.title}.`);
  }

  async function continueShow(userId: number, query: string): Promise<AlexaResponse> {
    if (!query) return speak("Which show?", ASK);
    const show = await findShow(query);
    if (!show) return speak(`I couldn't find a show called ${query}.`, ASK);
    const next = await showNextUp(show.id);
    return next ? playSaved(userId, next) : speak(`${show.title} has no episodes I can play.`);
  }

  /** "Play my pick": the exact title the room's tablet chose, typed to this Echo moments ago. */
  async function playRoomPick(userId: number, envelope: AlexaEnvelope): Promise<AlexaResponse> {
    const deviceId = envelopeDeviceId(envelope);
    const found = deviceId && dependencies.roomPick ? await dependencies.roomPick(userId, deviceId) : { room: null, pick: null };
    if (!found.room) return speak("This Echo isn't paired with a room yet, so I can't tell what was picked for it. Say, for example, this is the kitchen.");
    if (!found.pick) return resumeLatest(userId, true);
    const title = await item(found.pick.itemId);
    if (!title) return speak("I couldn't find that in Plex any more.");
    if (found.pick.startSeconds === null) return playSaved(userId, title);
    return play(userId, title, found.pick.startSeconds, `Playing ${spokenTitle(title)}.`);
  }

  async function seekTo(userId: number, envelope: AlexaEnvelope, target: (playing: { item: PlexItem; position: number }) => number | null, speech: boolean, noTarget: string): Promise<AlexaResponse> {
    const playing = await current(envelope);
    if (!playing) return speech ? speak(`Nothing is playing. ${ASK}`, ASK) : silent();
    const position = target(playing);
    if (position === null) return speech ? speak(noTarget) : silent();
    return play(userId, playing.item, position, undefined);
  }

  /** Next: a show's next episode; in a movie, its next chapter. */
  async function next(userId: number, envelope: AlexaEnvelope, speech: boolean): Promise<AlexaResponse> {
    const playing = await current(envelope);
    if (!playing) return speech ? speak(`Nothing is playing. ${ASK}`, ASK) : silent();
    if (playing.item.type === "episode") {
      await save(playing.item, playing.position, "next");
      const after = await neighbour(playing.item, 1);
      if (!after) return speech ? speak("This is the last episode.") : silent();
      return play(userId, after, movieResumePosition(after), speech ? `Playing ${spokenTitle(after)}.` : undefined);
    }
    const chapters = playing.item.chapters;
    const nextChapter = chapters[chapterAt(chapters, playing.position) + 1];
    if (!nextChapter) return speech ? speak(chapters.length ? "This is the last chapter." : "This movie has no chapters.") : silent();
    return play(userId, playing.item, nextChapter.start, undefined);
  }

  async function previous(userId: number, envelope: AlexaEnvelope, speech: boolean): Promise<AlexaResponse> {
    const playing = await current(envelope);
    if (!playing) return speech ? speak(`Nothing is playing. ${ASK}`, ASK) : silent();
    if (playing.item.type === "episode") {
      // Well into an episode, previous goes back to its start, as on a TV remote.
      if (playing.position > 60) return play(userId, playing.item, 0, undefined);
      const before = await neighbour(playing.item, -1);
      if (!before) return play(userId, playing.item, 0, undefined);
      return play(userId, before, 0, speech ? `Playing ${spokenTitle(before)}.` : undefined);
    }
    const chapters = playing.item.chapters;
    const here = chapterAt(chapters, playing.position);
    const chapter = here < 0 ? null : playing.position - chapters[here]!.start > 10 ? chapters[here] : chapters[Math.max(0, here - 1)];
    return play(userId, playing.item, chapter?.start ?? 0, undefined);
  }

  async function whatIsPlaying(envelope: AlexaEnvelope): Promise<AlexaResponse> {
    const playing = await current(envelope);
    if (!playing) return speak(`Nothing is playing. ${ASK}`, ASK);
    const year = playing.item.type === "movie" && playing.item.year ? `, from ${playing.item.year}` : "";
    return speak(`This is ${spokenTitle(playing.item)}${year}.`);
  }

  async function howMuchLeft(envelope: AlexaEnvelope): Promise<AlexaResponse> {
    const playing = await current(envelope);
    if (!playing) return speak(`Nothing is playing. ${ASK}`, ASK);
    const left = Math.max(0, playing.item.duration - playing.position);
    return speak(`There's ${spokenDuration(left)} left${playing.item.type === "episode" ? " in this episode" : ""}.`);
  }

  const skipAmount = (envelope: AlexaEnvelope) => isoDurationSeconds(envelope.request?.intent?.slots?.duration?.value) ?? DEFAULT_SKIP_SECONDS;

  async function intent(userId: number, envelope: AlexaEnvelope): Promise<AlexaResponse> {
    const name = envelope.request?.intent?.name ?? "";
    const query = envelope.request?.intent?.slots?.query?.value?.trim().slice(0, 200) ?? "";
    if (name === "ResumeWatchingIntent") return resumeLatest(userId, true);
    if (name === "PlayRoomPickIntent") return playRoomPick(userId, envelope);
    if (name === "PlayTitleIntent") {
      if (!query) return speak(ASK, HELP);
      // "Play the next episode of X" can land here as "play {query}".
      const nextOf = query.match(/^(?:the )?(?:next|latest|new) episode of (.+)$/i)?.[1];
      if (nextOf) return continueShow(userId, nextOf);
      const episode = parseEpisodeRequest(query);
      return episode ? playEpisode(userId, episode) : playTitle(userId, query);
    }
    if (name === "ContinueShowIntent") return continueShow(userId, query);
    if (name === "WhatIsPlayingIntent") return whatIsPlaying(envelope);
    if (name === "TimeLeftIntent") return howMuchLeft(envelope);
    if (name === "SkipForwardIntent" || name === "SkipBackIntent") {
      const change = skipAmount(envelope) * (name === "SkipBackIntent" ? -1 : 1);
      return seekTo(userId, envelope, ({ position }) => Math.max(0, position + change), true, "");
    }
    if (name === "SeekToIntent") {
      const target = isoDurationSeconds(envelope.request?.intent?.slots?.position?.value);
      return seekTo(userId, envelope, () => target, true, "Where to? Say, for example, jump to 1 hour 10 minutes.");
    }
    if (name === "AMAZON.NextIntent") return next(userId, envelope, true);
    if (name === "AMAZON.PreviousIntent") return previous(userId, envelope, true);
    if (name === "AMAZON.StartOverIntent") return seekTo(userId, envelope, () => 0, true, "");
    if (STOP_INTENTS.has(name)) return silent([stopDirective]);
    if (name === "AMAZON.ResumeIntent") return resume(userId, envelope, true);
    if (UNSUPPORTED_INTENTS.has(name)) return speak("Sorry, Hoban Plex can't do that.");
    return speak(HELP, ASK);
  }

  async function audioEvent(userId: number, envelope: AlexaEnvelope, type: string): Promise<AlexaResponse> {
    const token = envelope.request?.token;
    const itemId = decodeMovieToken(token);
    if (!itemId || !token) return silent();
    const found = await item(itemId);
    if (!found) return silent();
    const reported = type === "AudioPlayer.PlaybackFailed"
      ? envelope.request?.currentPlaybackState?.offsetInMilliseconds ?? envelope.context?.AudioPlayer?.offsetInMilliseconds
      : envelope.request?.offsetInMilliseconds;
    const position = Math.max(0, (Number(reported) || 0) / 1000);

    if (type === "AudioPlayer.ProgressReportIntervalElapsed") await save(found, position, "report", "playing");
    else if (type === "AudioPlayer.PlaybackStopped") {
      if (now() - (lastPlay.get(found.id) ?? 0) > REPLACED_STREAM_GRACE_MS) await save(found, position, "stopped");
    } else if (type === "AudioPlayer.PlaybackFinished") {
      await save(found, found.duration, "finished");
    } else if (type === "AudioPlayer.PlaybackNearlyFinished") {
      // A show carries on into its next episode, from the start.
      const after = found.type === "episode" ? await neighbour(found, 1).catch(() => null) : null;
      if (after) return silent([directive(after, 0, "ENQUEUE", userId, token)]);
    } else if (type === "AudioPlayer.PlaybackFailed") {
      log.warn("alexa.playback_failed", { skill: "movies", itemId: found.id, error: envelope.request?.error?.type, message: envelope.request?.error?.message });
      await save(found, position, "failed");
    }
    return silent();
  }

  async function controller(userId: number, envelope: AlexaEnvelope, type: string): Promise<AlexaResponse> {
    if (type === "PlaybackController.PauseCommandIssued") return silent([stopDirective]);
    if (type === "PlaybackController.PlayCommandIssued") return resume(userId, envelope, false);
    if (type === "PlaybackController.NextCommandIssued") return next(userId, envelope, false);
    if (type === "PlaybackController.PreviousCommandIssued") return previous(userId, envelope, false);
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
        log.warn("alexa.exception", { skill: "movies", error: envelope.request?.error?.type, message: envelope.request?.error?.message });
      }
      return silent();
    } catch (error) {
      log.warn("alexa.request_failed", { skill: "movies", type, error: error instanceof Error ? error.message : String(error) });
      if (type !== "IntentRequest" && type !== "LaunchRequest") return silent();
      return speak(error instanceof Unavailable ? "Hoban Plex isn't connected to Plex yet." : UNREACHABLE);
    }
  }

  /** Saves a place worked out while the stream plays (see alexaMovieProgressSync.ts). */
  async function saveEstimate(itemId: string, position: number): Promise<void> {
    const found = await item(itemId);
    if (found && position < found.duration) await save(found, position, "playing", "playing");
  }

  return { handle, item, saveEstimate };
}

export type AlexaMovieSkill = ReturnType<typeof createAlexaMovieSkill>;
