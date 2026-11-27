import type { AlexaResponse } from "./alexaPlayback";
import type { AlexaEnvelope } from "./alexaSkill";

export type AlexaSkillKind = "music" | "video";
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
  event?: { kind: "started" | "stopped" | "finished" | "failed"; token: string; offsetMs: number };
  /** The listener asked to stop, not pause. */
  stopRequested?: boolean;
}

const AUDIO_PATH = /\/(?:video-)?audio\/([A-Za-z0-9_-]{11})(?:[?#]|$)/;
const EVENTS: Record<string, "started" | "stopped" | "finished" | "failed"> = {
  "AudioPlayer.PlaybackStarted": "started",
  "AudioPlayer.PlaybackStopped": "stopped",
  "AudioPlayer.PlaybackFinished": "finished",
  "AudioPlayer.PlaybackFailed": "failed",
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
    const videoId = typeof stream.url === "string" ? stream.url.match(AUDIO_PATH)?.[1] : undefined;
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
 * The device's record after a change. `at` is when the event happened (Alexa's
 * timestamp) and `now` when the server saw it. `lookup` describes a stream
 * that started without this server having seen its Play directive, such as a
 * queued one; it gives the video ID and catalog details, or null.
 */
export async function applyNowPlayingChange(
  current: NowPlaying | null,
  change: NowPlayingChange,
  times: { at: number; now: number },
  lookup: (token: string) => Promise<{ videoId: string; item: NowPlayingItem } | null>,
): Promise<NowPlaying | null> {
  const iso = (ms: number) => new Date(ms).toISOString();
  let record = current ? { ...current } : null;
  const { event } = change;

  if (event) {
    if (event.kind === "started") {
      if (!record || record.token !== event.token) {
        const found = await lookup(event.token);
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
    } else if (record && record.token === event.token) {
      // An event for a stream already replaced (by a skip, say) says nothing about the current one.
      record.offsetMs = event.offsetMs;
      record.startedAt = null;
      record.state = event.kind === "stopped" ? (record.state === "stopped" ? "stopped" : "paused") : event.kind;
    }
  }

  if (change.stopRequested && record && (record.state === "playing" || record.state === "paused")) {
    record.state = "stopped";
    record.startedAt = null;
  }

  if (change.play) {
    const { play } = change;
    const same = record?.videoId === play.videoId;
    const looked = play.item.durationMs == null ? await lookup(play.token) : null;
    const item = { ...play.item, durationMs: looked?.item.durationMs ?? play.item.durationMs };
    record = {
      token: play.token, videoId: play.videoId,
      title: item.title || (same ? record!.title : looked?.item.title ?? ""),
      artist: item.artist || (same ? record!.artist : looked?.item.artist ?? ""),
      art: item.art || (same ? record!.art : looked?.item.art ?? ""),
      durationMs: item.durationMs ?? (same ? record!.durationMs : null),
      // Until the Echo reports PlaybackStarted, assume it starts now from the given place.
      state: "playing",
      offsetMs: play.offsetMs,
      startedAt: iso(times.now - play.offsetMs),
      nextToken: null,
      updatedAt: iso(times.now),
    };
  }

  if (change.enqueue && record) record.nextToken = change.enqueue.token;
  if (record) record.updatedAt = iso(times.now);
  return record;
}

/** Where playback has got to at `now`: the reported position, plus the time since, while playing. */
export function nowPlayingPosition(record: Pick<NowPlaying, "state" | "offsetMs" | "startedAt" | "durationMs">, now: number): number {
  const started = record.state === "playing" && record.startedAt ? Date.parse(record.startedAt) : NaN;
  const position = Number.isFinite(started) ? Math.max(0, now - started) : record.offsetMs;
  return record.durationMs ? Math.min(position, record.durationMs) : position;
}
