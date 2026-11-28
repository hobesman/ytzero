import type { AlexaResponse } from "./alexaPlayback";
import type { AlexaEnvelope } from "./alexaSkill";

/**
 * An Echo told to play a stream with the token of the stream it holds (a
 * paused one, say) carries on with the stream it has: it fetches the old
 * address again, from that stream's start, while reporting the new offset
 * as its place. A resume of a video sent the same video's token with a later
 * start, so the Echo replayed the old start (a minute behind, three resumes
 * on) and the room tablet's subtitles ran ahead of the audio.
 *
 * So every Play's token carries where its stream starts: "~" and the offset
 * in milliseconds, base 36. Two Plays share a token only when they share a
 * start, when reusing the stream is right. The skills never see the suffix:
 * it is taken off every token an Echo reports before a skill reads it, and
 * put on each Play as the answer leaves. No skill's token contains "~"
 * (base64url, IDs, dots and commas).
 */

const SUFFIX = /~[0-9a-z]{1,12}$/;

export const withoutStreamStart = (token: string): string => token.replace(SUFFIX, "");

export const withStreamStart = (token: string, offsetMs: number): string =>
  `${withoutStreamStart(token)}~${Math.max(0, Math.round(offsetMs)).toString(36)}`;

const strip = (token: unknown) => typeof token === "string" ? withoutStreamStart(token) : token;

/** The request with every stream token as its skill made it. */
export function envelopeWithoutStreamStarts(envelope: AlexaEnvelope): AlexaEnvelope {
  const request = envelope.request;
  const player = envelope.context?.AudioPlayer;
  const state = request?.currentPlaybackState;
  return {
    ...envelope,
    request: request && {
      ...request,
      ...(request.token != null ? { token: strip(request.token) as string } : {}),
      ...(state ? { currentPlaybackState: { ...state, ...(state.token != null ? { token: strip(state.token) as string } : {}) } } : {}),
    },
    context: envelope.context && {
      ...envelope.context,
      ...(player ? { AudioPlayer: { ...player, ...(player.token != null ? { token: strip(player.token) as string } : {}) } } : {}),
    },
  };
}

/**
 * The answer with each Play's token marked with its start. A queued Play's
 * expected previous token becomes the one the Echo really holds, which the
 * request named (as the event's stream or the player's).
 */
export function responseWithStreamStarts(response: AlexaResponse, envelope: AlexaEnvelope): AlexaResponse {
  const directives = Array.isArray(response.response?.directives) ? response.response.directives as Record<string, any>[] : [];
  if (!directives.some((directive) => directive?.type === "AudioPlayer.Play")) return response;
  const held = [envelope.request?.token, envelope.context?.AudioPlayer?.token, envelope.request?.currentPlaybackState?.token]
    .filter((token): token is string => typeof token === "string" && token.length > 0);
  const actual = (token: string) => held.find((candidate) => withoutStreamStart(candidate) === withoutStreamStart(token)) ?? token;
  const marked = directives.map((directive) => {
    const stream = directive?.type === "AudioPlayer.Play" ? directive.audioItem?.stream : null;
    if (!stream || typeof stream.token !== "string") return directive;
    return {
      ...directive,
      audioItem: {
        ...directive.audioItem,
        stream: {
          ...stream,
          token: withStreamStart(stream.token, Number(stream.offsetInMilliseconds) || 0),
          ...(typeof stream.expectedPreviousToken === "string" ? { expectedPreviousToken: actual(stream.expectedPreviousToken) } : {}),
        },
      },
    };
  });
  return { ...response, response: { ...response.response, directives: marked } };
}
