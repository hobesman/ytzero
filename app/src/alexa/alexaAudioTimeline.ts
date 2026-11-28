import type { AlexaAudioKind } from "./alexaAudioLinks";
import { isProcessed, toEchoTime, toVideoTime, type AlexaAudioPlans, type AudioPlan } from "./alexaAudioPlan";
import type { AlexaResponse } from "./alexaPlayback";
import type { AlexaEnvelope } from "./alexaSkill";

/**
 * The boundary between the Echo's timeline and the video's (see
 * alexaAudioPlan.ts). The skills work in video time throughout, as if
 * nothing were cut: places an Echo reports are turned into video time before
 * a skill sees them, and each Play a skill sends is turned into a processed
 * stream whose offset is on the cut timeline.
 */

type Plans = Pick<AlexaAudioPlans, "get" | "peek">;

// The skills' plain and playlist links; a processed link is already rewritten.
const AUDIO_URL = /\/alexa\/(?:video-)?audio\/([A-Za-z0-9_-]{11})(?:\/index\.m3u8)?(?:[?#]|$)/;

const toVideoMs = (plan: AudioPlan, echoMs: unknown): unknown =>
  typeof echoMs === "number" && Number.isFinite(echoMs) ? Math.round(toVideoTime(plan.cuts, echoMs / 1000) * 1000) : echoMs;

/** A copy of the request with every place an Echo reported in video time. Streams this server didn't process are left as they are. */
export function envelopeInVideoTime(envelope: AlexaEnvelope, userId: number, kind: AlexaAudioKind, plans: Plans, videoOf: (token: string) => string | null): AlexaEnvelope {
  const planFor = (token: unknown) => {
    const videoId = typeof token === "string" && token ? videoOf(token) : null;
    const plan = videoId ? plans.peek(userId, kind, videoId) : null;
    return isProcessed(plan) && plan.cuts.length ? plan : null;
  };
  const request = envelope.request;
  const player = envelope.context?.AudioPlayer;
  const state = request?.currentPlaybackState;
  const forRequest = planFor(request?.token);
  const forPlayer = planFor(player?.token);
  const forState = planFor(state?.token ?? request?.token);
  if (!forRequest && !forPlayer && !forState) return envelope;
  return {
    ...envelope,
    request: request && {
      ...request,
      ...(forRequest && request.offsetInMilliseconds != null ? { offsetInMilliseconds: toVideoMs(forRequest, request.offsetInMilliseconds) as number } : {}),
      ...(forState && state ? { currentPlaybackState: { ...state, offsetInMilliseconds: toVideoMs(forState, state.offsetInMilliseconds) as number } } : {}),
    },
    context: envelope.context && {
      ...envelope.context,
      ...(forPlayer && player ? { AudioPlayer: { ...player, offsetInMilliseconds: toVideoMs(forPlayer, player.offsetInMilliseconds) as number } } : {}),
    },
  };
}

/**
 * The skill's answer with each Play of a stream that has a plan turned into
 * the processed stream: from the place the skill asked for (or the end of a
 * cut it falls in), with that place on the cut timeline as its offset.
 */
export async function responseInEchoTime(
  response: AlexaResponse, userId: number, kind: AlexaAudioKind, plans: Plans,
  link: (videoId: string, startSeconds: number) => string,
): Promise<AlexaResponse> {
  const directives = Array.isArray(response.response?.directives) ? response.response.directives as Record<string, any>[] : [];
  let changed = false;
  const rewritten = await Promise.all(directives.map(async (directive) => {
    const stream = directive?.type === "AudioPlayer.Play" ? directive.audioItem?.stream : null;
    const videoId = typeof stream?.url === "string" ? stream.url.match(AUDIO_URL)?.[1] : null;
    if (!videoId) return directive;
    const plan = await plans.get(userId, kind, videoId);
    if (!isProcessed(plan)) return directive;
    const asked = Math.max(0, Number(stream.offsetInMilliseconds) || 0) / 1000;
    const echo = toEchoTime(plan.cuts, asked);
    const start = toVideoTime(plan.cuts, echo);
    changed = true;
    return { ...directive, audioItem: { ...directive.audioItem, stream: { ...stream, url: link(videoId, start), offsetInMilliseconds: Math.round(echo * 1000) } } };
  }));
  return changed ? { ...response, response: { ...response.response, directives: rewritten } } : response;
}

/**
 * Where a stream that started at `offsetMs` (video time) has got to after
 * `elapsedMs` of playing: the elapsed time runs on the cut timeline.
 */
export function livePosition(plan: AudioPlan | null, offsetMs: number, elapsedMs: number): number {
  if (!plan?.cuts.length) return offsetMs + elapsedMs;
  return Math.round(toVideoTime(plan.cuts, toEchoTime(plan.cuts, offsetMs / 1000) + elapsedMs / 1000) * 1000);
}
