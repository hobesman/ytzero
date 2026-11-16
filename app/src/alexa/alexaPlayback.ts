import { parseStationSeed, type StationSeed } from "../music/musicStation";

/**
 * Alexa hands back the token of whatever it is playing with every event, so
 * the token carries the whole station: its seed, the song, and what came
 * before. Nothing about a listening session is kept on the server.
 */
export interface AlexaPlaybackState {
  seed: StationSeed;
  videoId: string;
  /** Songs played before this one, oldest first. */
  served: string[];
  /** Songs the listener skipped. */
  skipped: string[];
  /** Songs in a row that failed to play, to stop a broken stream from skipping forever. */
  failures: number;
  /** This song already failed once and was started again from where it stopped. */
  retried?: boolean;
}

const TOKEN_PREFIX = "yz1.";
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
// Alexa caps a stream token at 1024 characters; these keep it near 700.
export const SERVED_HISTORY_LIMIT = 25;
export const SKIPPED_HISTORY_LIMIT = 10;

const packIds = (ids: readonly string[], limit: number) => ids.filter((id) => VIDEO_ID.test(id)).slice(-limit).join("");
const unpackIds = (value: unknown): string[] => typeof value === "string" ? value.match(/[A-Za-z0-9_-]{11}/g) ?? [] : [];

export function encodePlaybackToken(state: AlexaPlaybackState): string {
  const payload = {
    s: state.seed,
    v: state.videoId,
    h: packIds(state.served, SERVED_HISTORY_LIMIT),
    k: packIds(state.skipped, SKIPPED_HISTORY_LIMIT),
    f: state.failures || undefined,
    r: state.retried ? 1 : undefined,
  };
  return TOKEN_PREFIX + Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodePlaybackToken(token: unknown): AlexaPlaybackState | null {
  if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX)) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(token.slice(TOKEN_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const seed = parseStationSeed(payload?.s);
  const videoId = payload?.v;
  if (!seed || typeof videoId !== "string" || !VIDEO_ID.test(videoId)) return null;
  const failures = Number(payload.f ?? 0);
  return {
    seed,
    videoId,
    served: unpackIds(payload.h),
    skipped: unpackIds(payload.k),
    failures: Number.isSafeInteger(failures) && failures > 0 ? failures : 0,
    ...(payload.r === 1 ? { retried: true } : {}),
  };
}

/** The same song again after it failed, to start from where it stopped. */
export function retriedState(state: AlexaPlaybackState): AlexaPlaybackState {
  return { ...state, failures: state.failures + 1, retried: true };
}

/** The state once the current song has moved into the history. */
export function advancedState(state: AlexaPlaybackState, nextVideoId: string, skippedCurrent: boolean, failed = false): AlexaPlaybackState {
  return {
    seed: state.seed,
    videoId: nextVideoId,
    served: [...state.served, state.videoId].slice(-SERVED_HISTORY_LIMIT),
    skipped: skippedCurrent ? [...state.skipped, state.videoId].slice(-SKIPPED_HISTORY_LIMIT) : state.skipped,
    failures: failed ? state.failures + 1 : 0,
  };
}

// ---------- responses ----------

export interface AlexaTrack {
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
}

export interface AlexaResponse {
  version: "1.0";
  response: Record<string, unknown>;
  /** Carried to the session's next request, for a question awaiting yes or no. */
  sessionAttributes?: Record<string, unknown>;
}

const respond = (response: Record<string, unknown>): AlexaResponse => ({ version: "1.0", response });

export function speak(text: string, reprompt?: string): AlexaResponse {
  return respond({
    outputSpeech: { type: "PlainText", text },
    ...(reprompt ? { reprompt: { outputSpeech: { type: "PlainText", text: reprompt } } } : {}),
    shouldEndSession: !reprompt,
  });
}

/** AudioPlayer and PlaybackController requests may answer with directives only. */
export function silent(directives: unknown[] = []): AlexaResponse {
  return respond(directives.length ? { directives, shouldEndSession: true } : {});
}

export function playDirective(input: {
  track: AlexaTrack;
  url: string;
  token: string;
  behavior: "REPLACE_ALL" | "ENQUEUE";
  offsetInMilliseconds?: number;
  expectedPreviousToken?: string;
}): Record<string, unknown> {
  const art = /^https:\/\//.test(input.track.thumbnail) ? { art: { sources: [{ url: input.track.thumbnail }] } } : {};
  return {
    type: "AudioPlayer.Play",
    playBehavior: input.behavior,
    audioItem: {
      stream: {
        url: input.url,
        token: input.token,
        offsetInMilliseconds: Math.max(0, Math.floor(input.offsetInMilliseconds ?? 0)),
        ...(input.behavior === "ENQUEUE" && input.expectedPreviousToken ? { expectedPreviousToken: input.expectedPreviousToken } : {}),
      },
      metadata: { title: input.track.title, subtitle: input.track.artist, ...art },
    },
  };
}

export const stopDirective = { type: "AudioPlayer.Stop" };

export function playResponse(speech: string | null, directive: Record<string, unknown>): AlexaResponse {
  return respond({
    ...(speech ? { outputSpeech: { type: "PlainText", text: speech } } : {}),
    directives: [directive],
    shouldEndSession: true,
  });
}
