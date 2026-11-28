import type { AudiobookshelfClient, Book, BookProgress, BookSummary } from "../audiobookshelf/audiobookshelfClient";
import { filterValue, isBookId } from "../audiobookshelf/audiobookshelfClient";
import { log } from "../logger";
import {
  bookPosition, chapterAt, nextChapterStart, placeInBook, previousChapterStart, resumePosition, spokenChapter, spokenDuration, timeLeft,
} from "./alexaBookMath";
import { playResponse, silent, speak, stopDirective, type AlexaResponse } from "./alexaPlayback";
import { envelopeDeviceId, type AlexaEnvelope } from "./alexaSkill";
import { bestMatch, isoDurationSeconds, normalizeSpoken, TITLE_MATCH_MIN, titleScore } from "./alexaVideoMatch";

/**
 * Hoban Books: audiobooks from the user's Audiobookshelf server on an Echo.
 * The place is kept in Audiobookshelf, so the phone app carries on from where
 * the kitchen stopped and the other way round: saved on every progress report
 * the Echo sends (about once a minute), and on pause, stop, finish and
 * failure. A book in many files plays one file at a time, the next queued as
 * the last nears its end.
 */
export type BookApi = Pick<AudiobookshelfClient, "book" | "progress" | "saveProgress" | "inProgress" | "bookLibraries" | "search" | "libraryBooks" | "allProgress">;

/** A book a tablet queued for a room, for "play my book". */
export interface QueuedBook { bookId: string; title: string; startSeconds: number | null }

export interface AlexaBookSkillDependencies {
  /** Audiobookshelf, or why it isn't there. */
  books: () => BookApi | { disabled: string };
  /** The stream for one file of a book from `startSeconds` into that file. */
  audioLink: (bookId: string, fileIndex: number, userId: number, startSeconds: number) => string;
  /** A cover the Echo's screen can fetch. */
  coverLink: (bookId: string) => string;
  /** The room this Echo is paired with, and the book queued there. */
  roomBook?: (userId: number, deviceId: string) => Promise<{ room: string | null; book: QueuedBook | null }>;
  now?: () => number;
}

const TOKEN_PREFIX = "hb1.";
/** About how often the Echo reports where it is, and so how much a pulled plug can lose. */
export const BOOK_PROGRESS_REPORT_MS = 60_000;
const DEFAULT_SKIP_SECONDS = 30;
/** A Stopped event this soon after a new Play is the old stream giving way, not the listener's place. */
const REPLACED_STREAM_GRACE_MS = 8_000;
const BOOK_CACHE_MS = 2 * 60_000;
const BOOK_CACHE_LIMIT = 32;
/** A stream that finished this close to the book's end means the book is done. */
const FINISHED_MARGIN_SECONDS = 60;

const ASK = "Which book would you like? Say resume my book, or a title.";
const HELP = "You can say resume my book, play a book's title, play a book by an author, play the next one in the series, or play my book for the one queued on the tablet. While a book plays, say next or previous for chapters, skip back thirty seconds, what am I listening to, or how much is left.";
const UNREACHABLE = "Sorry, I couldn't reach Audiobookshelf right now. Please try again in a moment.";
const STOP_INTENTS = new Set(["AMAZON.PauseIntent", "AMAZON.StopIntent", "AMAZON.CancelIntent"]);
const UNSUPPORTED_INTENTS = new Set([
  "AMAZON.LoopOnIntent", "AMAZON.LoopOffIntent", "AMAZON.ShuffleOnIntent", "AMAZON.ShuffleOffIntent", "AMAZON.RepeatIntent",
]);

/** The stream token: the book and the file, nothing more. */
export const encodeBookToken = (bookId: string, fileIndex: number) => `${TOKEN_PREFIX}${bookId}.${fileIndex}`;
export function decodeBookToken(token: unknown): { bookId: string; fileIndex: number } | null {
  if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX)) return null;
  const match = token.slice(TOKEN_PREFIX.length).match(/^([A-Za-z0-9_-]{1,64})\.(\d{1,4})$/);
  return match && isBookId(match[1]) ? { bookId: match[1]!, fileIndex: Number(match[2]) } : null;
}

class Unavailable extends Error {}

/** The series number in a summary's "Name #3" series text, for the series with this name. */
function sequenceIn(summary: Pick<BookSummary, "seriesName">, seriesName: string): number | null {
  for (const part of (summary.seriesName ?? "").split(",")) {
    const match = part.trim().match(/^(.*?)\s*#\s*([\d.]+)$/);
    if (match && normalizeSpoken(match[1]!) === normalizeSpoken(seriesName)) return Number.parseFloat(match[2]!);
  }
  return null;
}

export function createAlexaBookSkill(dependencies: AlexaBookSkillDependencies) {
  const now = dependencies.now ?? Date.now;
  const cache = new Map<string, { book: Book; at: number }>();
  /** The last Play sent for each book, so the old stream's Stopped event doesn't overwrite the new place. */
  const lastPlay = new Map<string, number>();

  const api = (): BookApi => {
    const books = dependencies.books();
    if ("disabled" in books) throw new Unavailable(books.disabled);
    return books;
  };

  async function book(bookId: string): Promise<Book | null> {
    const cached = cache.get(bookId);
    if (cached && now() - cached.at < BOOK_CACHE_MS) return cached.book;
    const found = await api().book(bookId);
    if (found) {
      cache.set(bookId, { book: found, at: now() });
      while (cache.size > BOOK_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    }
    return found;
  }

  async function save(bookId: string, update: { currentTime: number; duration: number } | { isFinished: boolean }, reason: string): Promise<void> {
    try {
      await api().saveProgress(bookId, update);
    } catch (error) {
      log.warn("alexa.book_progress_failed", { bookId, reason, error: error instanceof Error ? error.message : String(error) });
    }
  }

  function directive(found: Book, position: number, behavior: "REPLACE_ALL" | "ENQUEUE", userId: number, previousToken?: string): Record<string, unknown> {
    const place = placeInBook(found, position);
    const offset = Math.floor(place.offset);
    const chapter = chapterAt(found, bookPosition(found, place.fileIndex, offset));
    return {
      type: "AudioPlayer.Play",
      playBehavior: behavior,
      audioItem: {
        stream: {
          url: dependencies.audioLink(found.id, place.fileIndex, userId, offset),
          token: encodeBookToken(found.id, place.fileIndex),
          // The stream itself starts here; see alexaBookAudio.ts.
          offsetInMilliseconds: offset * 1000,
          ...(behavior === "ENQUEUE" && previousToken ? { expectedPreviousToken: previousToken } : {}),
          progressReport: { progressReportIntervalInMilliseconds: BOOK_PROGRESS_REPORT_MS },
        },
        metadata: {
          title: found.title,
          subtitle: [found.author, chapter ? spokenChapter(chapter.chapter, chapter.index) : null].filter(Boolean).join(" · "),
          art: { sources: [{ url: dependencies.coverLink(found.id) }] },
        },
      },
    };
  }

  /** Plays the book from `position`, saving that place first so every device agrees on it. */
  async function play(userId: number, found: Book, position: number, speech?: string | null): Promise<AlexaResponse> {
    const place = placeInBook(found, position);
    const start = bookPosition(found, place.fileIndex, Math.floor(place.offset));
    lastPlay.set(found.id, now());
    await save(found.id, { currentTime: start, duration: found.duration }, "play");
    const play = directive(found, start, "REPLACE_ALL", userId);
    return speech === undefined ? silent([play]) : playResponse(speech, play);
  }

  /** Plays a book from its saved place in Audiobookshelf, restarting a finished one. */
  async function playSaved(userId: number, found: Book, intro: ((resuming: boolean) => string) | null): Promise<AlexaResponse> {
    const saved = await api().progress(found.id);
    if (saved?.isFinished) await save(found.id, { isFinished: false }, "restart");
    const position = resumePosition(found, saved);
    return play(userId, found, position, intro ? intro(position > 0) : undefined);
  }

  const playingIntro = (found: Book) => (resuming: boolean) => resuming
    ? `Resuming ${found.title}${found.author ? ` by ${found.author}` : ""}.`
    : `Playing ${found.title}${found.author ? ` by ${found.author}` : ""}.`;

  /** The book the Echo is playing or paused on, and the place it reports. */
  async function current(envelope: AlexaEnvelope): Promise<{ book: Book; position: number; token: string } | null> {
    const player = envelope.context?.AudioPlayer;
    const decoded = decodeBookToken(player?.token);
    const found = decoded ? await book(decoded.bookId) : null;
    if (!found || !decoded || !player?.token) return null;
    return { book: found, position: bookPosition(found, decoded.fileIndex, Math.max(0, (player.offsetInMilliseconds ?? 0) / 1000)), token: player.token };
  }

  async function latestInProgress(): Promise<Book | null> {
    for (const summary of await api().inProgress(5)) {
      const found = await book(summary.id);
      if (found) return found;
    }
    return null;
  }

  async function resumeLatest(userId: number, speech: boolean): Promise<AlexaResponse> {
    const found = await latestInProgress();
    if (!found) return speech ? speak("You don't have a book in progress. Which book would you like?", ASK) : silent();
    return playSaved(userId, found, speech ? playingIntro(found) : null);
  }

  /** Resume: the book on this Echo from the latest place saved anywhere, else the latest book in progress. */
  async function resume(userId: number, envelope: AlexaEnvelope, speech: boolean): Promise<AlexaResponse> {
    const playing = await current(envelope);
    if (!playing) return resumeLatest(userId, speech);
    const saved = await api().progress(playing.book.id).catch(() => null);
    const position = saved && !saved.isFinished ? saved.currentTime : playing.position;
    return play(userId, playing.book, position, undefined);
  }

  async function searchBooks(query: string): Promise<{ books: BookSummary[]; authors: { id: string; name: string; libraryId: string }[] }> {
    const books: BookSummary[] = [];
    const authors: { id: string; name: string; libraryId: string }[] = [];
    for (const library of await api().bookLibraries()) {
      const found = await api().search(library.id, query);
      books.push(...found.books.map((item) => ({ ...item, libraryId: item.libraryId || library.id })));
      authors.push(...found.authors.map((author) => ({ ...author, libraryId: library.id })));
    }
    return { books, authors };
  }

  async function findTitle(query: string): Promise<Book | null> {
    const { books } = await searchBooks(query);
    const match = bestMatch(query, books, (item) => item.title, titleScore, TITLE_MATCH_MIN)?.item ?? books[0];
    return match ? book(match.id) : null;
  }

  /** An author's book to play: the one in progress, else the first not finished, in order of publication. */
  async function findByAuthor(query: string): Promise<{ book: Book | null; author: string | null }> {
    const spoken = query.replace(/^(a |the )?(book|books|something) (by|from) /i, "").trim();
    const { authors } = await searchBooks(spoken);
    const author = bestMatch(spoken, authors, (item) => item.name, titleScore, TITLE_MATCH_MIN)?.item ?? authors[0];
    if (!author) return { book: null, author: null };
    const { books } = await api().libraryBooks(author.libraryId, { filter: `authors.${filterValue(author.id)}`, sort: "media.metadata.publishedYear", limit: 100 });
    if (!books.length) return { book: null, author: author.name };
    const progress = await api().allProgress().catch(() => new Map<string, BookProgress>());
    const inProgress = books.filter((item) => progress.get(item.id) && !progress.get(item.id)!.isFinished && progress.get(item.id)!.currentTime > 0)
      .sort((a, b) => progress.get(b.id)!.lastUpdate - progress.get(a.id)!.lastUpdate);
    const choice = inProgress[0] ?? books.find((item) => !progress.get(item.id)?.isFinished) ?? books[0]!;
    return { book: await book(choice.id), author: author.name };
  }

  /** The book after this one in its series: the series this one plays or was last played from. */
  async function nextInSeries(envelope: AlexaEnvelope): Promise<{ book: Book | null; message: string | null }> {
    const base = (await current(envelope))?.book ?? await latestInProgress();
    if (!base) return { book: null, message: "I'm not sure which series you mean. Play a book from it first." };
    const series = base.series[0];
    if (!series) return { book: null, message: `${base.title} isn't part of a series.` };
    const { books } = await api().libraryBooks(base.libraryId, { filter: `series.${filterValue(series.id)}`, limit: 200 });
    const ordered = books.map((item) => ({ item, sequence: sequenceIn(item, series.name) }))
      .filter((entry) => entry.sequence !== null).sort((a, b) => a.sequence! - b.sequence!);
    const here = series.sequence ? Number.parseFloat(series.sequence) : ordered.find((entry) => entry.item.id === base.id)?.sequence ?? null;
    const next = here === null ? null : ordered.find((entry) => entry.sequence! > here && entry.item.id !== base.id);
    if (!next) return { book: null, message: `${base.title} is the last book I have in ${series.name}.` };
    return { book: await book(next.item.id), message: null };
  }

  async function seekTo(userId: number, envelope: AlexaEnvelope, target: (playing: { book: Book; position: number }) => number | null, speech: boolean, noTarget: string): Promise<AlexaResponse> {
    const playing = await current(envelope);
    if (!playing) return speech ? speak(`No book is playing. ${ASK}`, ASK) : silent();
    const position = target(playing);
    if (position === null) return speech ? speak(noTarget) : silent();
    return play(userId, playing.book, position, undefined);
  }

  const skipAmount = (envelope: AlexaEnvelope) => isoDurationSeconds(envelope.request?.intent?.slots?.duration?.value) ?? DEFAULT_SKIP_SECONDS;

  const nextChapter = (userId: number, envelope: AlexaEnvelope, speech: boolean) =>
    seekTo(userId, envelope, ({ book: found, position }) => nextChapterStart(found, position), speech, "This is the last chapter.");
  const previousChapter = (userId: number, envelope: AlexaEnvelope, speech: boolean) =>
    seekTo(userId, envelope, ({ book: found, position }) => previousChapterStart(found, position), speech, "This book has no chapters.");

  async function whatIsPlaying(envelope: AlexaEnvelope): Promise<AlexaResponse> {
    const playing = await current(envelope);
    if (!playing) return speak(`No book is playing. ${ASK}`, ASK);
    const chapter = chapterAt(playing.book, playing.position);
    const by = playing.book.author ? ` by ${playing.book.author}` : "";
    return speak(`This is ${playing.book.title}${by}${chapter ? `, ${spokenChapter(chapter.chapter, chapter.index)}` : ""}.`);
  }

  async function howMuchLeft(envelope: AlexaEnvelope): Promise<AlexaResponse> {
    const playing = await current(envelope);
    if (!playing) return speak(`No book is playing. ${ASK}`, ASK);
    const left = timeLeft(playing.book, playing.position);
    // The slot's synonyms ("this chapter", "the whole book", "track") arrive as spoken: go by the word in them.
    const spoken = normalizeSpoken(envelope.request?.intent?.slots?.scope?.value ?? "");
    const scope = /\b(chapter|track|part)\b/.test(spoken) ? "chapter" : /\b(book|audiobook|story)\b/.test(spoken) ? "book" : "";
    const inBook = `${spokenDuration(left.book)} left in the book`;
    if (left.chapter === null || scope === "book") return speak(`There's ${inBook}.`);
    const inChapter = `${spokenDuration(left.chapter)} left in this chapter`;
    return speak(scope === "chapter" ? `There's ${inChapter}.` : `There's ${inChapter}, and ${inBook}.`);
  }

  async function playRoomBook(userId: number, envelope: AlexaEnvelope): Promise<AlexaResponse> {
    const deviceId = envelopeDeviceId(envelope);
    const queued = deviceId && dependencies.roomBook ? await dependencies.roomBook(userId, deviceId) : { room: null, book: null };
    if (!queued.book) {
      if (!queued.room) return resumeLatest(userId, true);
      const latest = await latestInProgress();
      if (!latest) return speak(`There's no book queued for the ${queued.room}. ${ASK}`, ASK);
      return playSaved(userId, latest, (resuming) => `There's no book queued for the ${queued.room}, so ${resuming ? "resuming" : "playing"} ${latest.title}.`);
    }
    const found = await book(queued.book.bookId);
    if (!found) return speak(`I couldn't find ${queued.book.title || "that book"} in Audiobookshelf.`);
    if (queued.book.startSeconds === null) return playSaved(userId, found, playingIntro(found));
    const chapter = chapterAt(found, queued.book.startSeconds);
    return play(userId, found, queued.book.startSeconds, `Playing ${found.title}${chapter ? `, from ${spokenChapter(chapter.chapter, chapter.index)}` : ""}.`);
  }

  async function intent(userId: number, envelope: AlexaEnvelope): Promise<AlexaResponse> {
    const name = envelope.request?.intent?.name ?? "";
    const query = envelope.request?.intent?.slots?.query?.value?.trim().slice(0, 200) ?? "";
    if (name === "ResumeBookIntent") return resumeLatest(userId, true);
    if (name === "PlayRoomBookIntent") return playRoomBook(userId, envelope);
    if (name === "PlayBookIntent") {
      if (!query) return speak(ASK, HELP);
      const found = await findTitle(query);
      return found ? playSaved(userId, found, playingIntro(found)) : speak(`I couldn't find a book called ${query}.`, ASK);
    }
    if (name === "PlayAuthorIntent") {
      if (!query) return speak("Which author?", ASK);
      const found = await findByAuthor(query);
      if (!found.book) return speak(found.author ? `I couldn't find a book by ${found.author}.` : `I couldn't find an author called ${query}.`, ASK);
      return playSaved(userId, found.book, playingIntro(found.book));
    }
    if (name === "NextInSeriesIntent") {
      const found = await nextInSeries(envelope);
      return found.book ? playSaved(userId, found.book, playingIntro(found.book)) : speak(found.message ?? ASK);
    }
    if (name === "WhatIsPlayingIntent") return whatIsPlaying(envelope);
    if (name === "TimeLeftIntent") return howMuchLeft(envelope);
    if (name === "SkipForwardIntent" || name === "SkipBackIntent") {
      const change = skipAmount(envelope) * (name === "SkipBackIntent" ? -1 : 1);
      return seekTo(userId, envelope, ({ position }) => position + change, true, "");
    }
    // "Jump to 2 hours 10 minutes": a place in the whole book, as the tablet's chapter bar sends it.
    if (name === "SeekToIntent") {
      const target = isoDurationSeconds(envelope.request?.intent?.slots?.position?.value);
      return seekTo(userId, envelope, () => target, true, "Where in the book? Say, for example, jump to 2 hours 10 minutes.");
    }
    if (name === "AMAZON.NextIntent") return nextChapter(userId, envelope, true);
    if (name === "AMAZON.PreviousIntent") return previousChapter(userId, envelope, true);
    if (name === "AMAZON.StartOverIntent") {
      return seekTo(userId, envelope, ({ book: found, position }) => chapterAt(found, position)?.chapter.start ?? 0, true, "");
    }
    if (STOP_INTENTS.has(name)) return silent([stopDirective]);
    if (name === "AMAZON.ResumeIntent") return resume(userId, envelope, true);
    if (UNSUPPORTED_INTENTS.has(name)) return speak("Sorry, Hoban Books can't do that.");
    return speak(HELP, ASK);
  }

  async function audioEvent(userId: number, envelope: AlexaEnvelope, type: string): Promise<AlexaResponse> {
    const token = envelope.request?.token;
    const decoded = decodeBookToken(token);
    if (!decoded || !token) return silent();
    const found = await book(decoded.bookId);
    if (!found) return silent();
    const reported = type === "AudioPlayer.PlaybackFailed"
      ? envelope.request?.currentPlaybackState?.offsetInMilliseconds ?? envelope.context?.AudioPlayer?.offsetInMilliseconds
      : envelope.request?.offsetInMilliseconds;
    const position = bookPosition(found, decoded.fileIndex, Math.max(0, (Number(reported) || 0) / 1000));
    const saveHere = (reason: string) => save(found.id, { currentTime: position, duration: found.duration }, reason);

    if (type === "AudioPlayer.ProgressReportIntervalElapsed") await saveHere("report");
    else if (type === "AudioPlayer.PlaybackStopped") {
      // A skip or a new book replaces the stream, and its place was saved with the new Play.
      if (now() - (lastPlay.get(found.id) ?? 0) > REPLACED_STREAM_GRACE_MS) await saveHere("stopped");
    } else if (type === "AudioPlayer.PlaybackFinished") {
      const last = decoded.fileIndex >= found.tracks.length - 1;
      const end = bookPosition(found, decoded.fileIndex, found.tracks[decoded.fileIndex]?.duration ?? 0);
      if (last && Math.max(position, end) >= found.duration - FINISHED_MARGIN_SECONDS) await save(found.id, { isFinished: true }, "finished");
      else await save(found.id, { currentTime: last ? position : end, duration: found.duration }, "finished");
    } else if (type === "AudioPlayer.PlaybackNearlyFinished") {
      const next = found.tracks[decoded.fileIndex + 1];
      if (next) return silent([directive(found, next.startOffset, "ENQUEUE", userId, token)]);
    } else if (type === "AudioPlayer.PlaybackFailed") {
      log.warn("alexa.playback_failed", { skill: "books", bookId: found.id, fileIndex: decoded.fileIndex, error: envelope.request?.error?.type, message: envelope.request?.error?.message });
      await saveHere("failed");
    }
    return silent();
  }

  async function controller(userId: number, envelope: AlexaEnvelope, type: string): Promise<AlexaResponse> {
    if (type === "PlaybackController.PauseCommandIssued") return silent([stopDirective]);
    if (type === "PlaybackController.PlayCommandIssued") return resume(userId, envelope, false);
    if (type === "PlaybackController.NextCommandIssued") return nextChapter(userId, envelope, false);
    if (type === "PlaybackController.PreviousCommandIssued") return previousChapter(userId, envelope, false);
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
        log.warn("alexa.exception", { skill: "books", error: envelope.request?.error?.type, message: envelope.request?.error?.message });
      }
      return silent();
    } catch (error) {
      log.warn("alexa.request_failed", { skill: "books", type, error: error instanceof Error ? error.message : String(error) });
      if (type !== "IntentRequest" && type !== "LaunchRequest") return silent();
      return speak(error instanceof Unavailable ? "Hoban Books isn't connected to Audiobookshelf yet." : UNREACHABLE);
    }
  }

  return { handle, book };
}

export type AlexaBookSkill = ReturnType<typeof createAlexaBookSkill>;
