import { BOOK_AUDIO_PATH } from "./alexaBookAudio";
import { MOVIE_AUDIO_PATH } from "./alexaMovieAudio";
import type { AlexaResponse } from "./alexaPlayback";
import type { AlexaEnvelope } from "./alexaSkill";

export type AlexaSkillKind = "music" | "video" | "books" | "movies";
export type NowPlayingState = "playing" | "paused" | "stopped" | "finished" | "failed";

/** One device's now playing, as stored. Times are ISO strings. */
export interface NowPlaying {
  token: string;
  videoId: string;
  title: string;
  artist: string;
  art: string;
  durationMs: number | null;
  state: NowPlayingState;
  /** The position Alexa last reported; Alexa reports it only on events. */
  offsetMs: number;
  /** While playing, when position 0 was, so a client can draw live progress. */
  startedAt: string | null;
  /** The stream queued after this one. */
  nextToken: string | null;
  updatedAt: string;
}

/** What the catalog knows about a video, for a stream whose Play directive this server didn't see. */
export interface NowPlayingItem {
  title: string;
  artist: string;
  art: string;
  durationMs: number | null;
}

/**
 * What one request and its answer say about the device. A Play directive
 * names the stream; AudioPlayer events say what became of it.
 */
export interface NowPlayingChange {
  /** A stream this server just told the Echo to play now. */
  play?: { token: string; videoId: string; item: NowPlayingItem; offsetMs: number };
  /** A stream queued to follow the current one. */
  enqueue?: { token: string };
  /** An event about a stream, with the position it reported. */
  event?: { kind: "started" | "stopped" | "finished" | "failed" | "progress"; token: string; offsetMs: number };
  /** The listener asked to stop, not pause. */
  stopRequested?: boolean;
}

// A processed stream (cut and levelled; see alexaProcessedAudio.ts) is the same video.
const AUDIO_PATH = /\/(?:video-)?audio\/([A-Za-z0-9_-]{11})(?:\/index\.m3u8|\/processed)?(?:[?#]|$)/;
const EVENTS: Record<string, "started" | "stopped" | "finished" | "failed" | "progress"> = {
  "AudioPlayer.PlaybackStarted": "started",
  "AudioPlayer.PlaybackStopped": "stopped",
  "AudioPlayer.PlaybackFinished": "finished",
  "AudioPlayer.PlaybackFailed": "failed",
  "AudioPlayer.ProgressReportIntervalElapsed": "progress",
};
const STOP_INTENTS = new Set(["AMAZON.StopIntent", "AMAZON.CancelIntent"]);

const offset = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));

/** Reads a request and the skill's answer into what changed on the device, or null if nothing did. */
export function nowPlayingChange(envelope: AlexaEnvelope, response: AlexaResponse): NowPlayingChange | null {
  const change: NowPlayingChange = {};
  const request = envelope.request;
  const kind = EVENTS[request?.type ?? ""];
  if (kind && typeof request?.token === "string" && request.token) {
    const reported = kind === "failed"
      ? request.currentPlaybackState?.offsetInMilliseconds ?? envelope.context?.AudioPlayer?.offsetInMilliseconds
      : request.offsetInMilliseconds;
    change.event = { kind, token: request.token, offsetMs: offset(reported) };
  }
  if (request?.type === "IntentRequest" && STOP_INTENTS.has(request.intent?.name ?? "")) change.stopRequested = true;
  const directives = Array.isArray(response.response.directives) ? response.response.directives as Record<string, any>[] : [];
  for (const directive of directives) {
    if (directive?.type !== "AudioPlayer.Play") continue;
    const stream = directive.audioItem?.stream;
    const token = typeof stream?.token === "string" ? stream.token : "";
    if (!token) continue;
    if (directive.playBehavior === "ENQUEUE") {
      change.enqueue = { token };
      continue;
    }
    // A book stream names its Audiobookshelf item, and a movie stream its Plex item, which stand in for the video.
    const videoId = typeof stream.url === "string" ? stream.url.match(AUDIO_PATH)?.[1] ?? stream.url.match(BOOK_AUDIO_PATH)?.[1] ?? stream.url.match(MOVIE_AUDIO_PATH)?.[1] : undefined;
    if (!videoId) continue;
    const metadata = directive.audioItem?.metadata ?? {};
    change.play = {
      token,
      videoId,
      offsetMs: offset(stream.offsetInMilliseconds),
      item: {
        title: String(metadata.title ?? ""),
        artist: String(metadata.subtitle ?? ""),
        art: String(metadata.art?.sources?.[0]?.url ?? ""),
        durationMs: null,
      },
    };
  }
  return change.play || change.enqueue || change.event || change.stopRequested ? change : null;
}

/**
 * A stream the skill sent in answer to this device, not yet reported started.
 * Alexa may play it on another Echo (one the device sends its audio to), so it
 * becomes now playing only on the Echo that reports PlaybackStarted.
 */
export interface PendingPlay {
  token: string;
  videoId: string;
  item: NowPlayingItem;
  offsetMs: number;
  requestedAt: string;
}

/** A device's record and the play it is waiting on. */
export interface DevicePlayback {
  current: NowPlaying | null;
  pending: PendingPlay | null;
}

export interface NowPlayingSources {
  /** Describes a stream that started with no Play directive seen for it, such as a queued one. */
  lookup: (token: string) => Promise<{ videoId: string; item: NowPlayingItem } | null>;
  /** Takes another device's pending play of this stream, which Alexa started here instead. */
  claimElsewhere: (token: string) => Promise<PendingPlay | null>;
}

/**
 * The device's record after a change. `at` is when the event happened (Alexa's
 * timestamp) and `now` when the server saw it.
 */
export async function applyNowPlayingChange(
  state: DevicePlayback,
  change: NowPlayingChange,
  times: { at: number; now: number },
  sources: NowPlayingSources,
): Promise<DevicePlayback> {
  const iso = (ms: number) => new Date(ms).toISOString();
  let record = state.current ? { ...state.current } : null;
  let pending = state.pending;
  const { event } = change;

  if (event) {
    if (event.kind === "started") {
      // The play this started, sent to this device or redirected here from another.
      const claimed = pending?.token === event.token ? pending : await sources.claimElsewhere(event.token);
      if (pending?.token === event.token) pending = null;
      if (!record || record.token !== event.token) {
        const found = claimed ? { videoId: claimed.videoId, item: claimed.item } : await sources.lookup(event.token);
        record = found ? {
          token: event.token, videoId: found.videoId, ...found.item,
          state: "playing", offsetMs: 0, startedAt: null, nextToken: null, updatedAt: iso(times.now),
        } : null;
      }
      if (record) {
        record.state = "playing";
        record.offsetMs = event.offsetMs;
        record.startedAt = iso(times.at - event.offsetMs);
        if (record.nextToken === record.token) record.nextToken = null;
      }
    } else if (event.kind === "progress") {
      // A progress report (books ask for one a minute) puts the live position right.
      if (record && record.token === event.token && record.state === "playing") {
        record.offsetMs = event.offsetMs;
        record.startedAt = iso(times.at - event.offsetMs);
      }
    } else if (record && record.token === event.token) {
      // An event for a stream already replaced (by a skip, say) says nothing about the current one.
      record.offsetMs = event.offsetMs;
      record.startedAt = null;
      record.state = event.kind === "stopped" ? (record.state === "stopped" ? "stopped" : "paused") : event.kind;
    }
    // A stream that failed before it ever started isn't waiting to play any more.
    if (event.kind === "failed" && pending?.token === event.token) pending = null;
  }

  if (change.stopRequested) {
    pending = null;
    if (record && (record.state === "playing" || record.state === "paused")) {
      record.state = "stopped";
      record.startedAt = null;
    }
  }

  if (change.play) {
    // Held until an Echo reports it started: what this device plays stays as it is meanwhile.
    const { play } = change;
    const same = record?.videoId === play.videoId ? record : null;
    const looked = play.item.durationMs == null ? await sources.lookup(play.token) : null;
    pending = {
      token: play.token,
      videoId: play.videoId,
      item: {
        title: play.item.title || same?.title || looked?.item.title || "",
        artist: play.item.artist || same?.artist || looked?.item.artist || "",
        art: play.item.art || same?.art || looked?.item.art || "",
        durationMs: looked?.item.durationMs ?? play.item.durationMs ?? same?.durationMs ?? null,
      },
      offsetMs: play.offsetMs,
      requestedAt: iso(times.now),
    };
  }

  if (change.enqueue && record) record.nextToken = change.enqueue.token;
  if (record) record.updatedAt = iso(times.now);
  return { current: record, pending };
}

/** Where playback has got to at `now`: the reported position, plus the time since, while playing. */
export function nowPlayingPosition(record: Pick<NowPlaying, "state" | "offsetMs" | "startedAt" | "durationMs">, now: number): number {
  const started = record.state === "playing" && record.startedAt ? Date.parse(record.startedAt) : NaN;
  const position = Number.isFinite(started) ? Math.max(0, now - started) : record.offsetMs;
  return record.durationMs ? Math.min(position, record.durationMs) : position;
}
