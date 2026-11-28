import type { AlexaResponse } from "./alexaPlayback";
import type { AlexaEnvelope } from "./alexaSkill";

/**
 * One log line per Alexa request: which skill, what was asked, and what the
 * skill did about it. That makes the server log enough to tell "Alexa never
 * sent it" from "the skill answered" from "the Echo couldn't play it".
 */
export function describeAlexaExchange(skill: "music" | "video" | "books", envelope: AlexaEnvelope, response: AlexaResponse): Record<string, unknown> {
  const request = envelope.request;
  const fields: Record<string, unknown> = { skill, type: request?.type ?? "unknown" };
  if (request?.intent?.name) fields.intent = request.intent.name;
  const slots = request?.intent?.slots ?? {};
  for (const [name, slot] of Object.entries(slots)) {
    if (slot?.value) fields[name] = slot.value.slice(0, 200);
  }
  if (request?.type?.startsWith("AudioPlayer.") && request.offsetInMilliseconds != null) {
    fields.position = Math.round(request.offsetInMilliseconds / 1000);
  }
  if (request?.error?.type) fields.error = request.error.type;
  const offer = (response.sessionAttributes as { channelOffer?: { action?: string; index?: number; candidates?: { title?: string }[] } } | undefined)?.channelOffer;
  if (offer) fields.offer = `${offer.action}: ${offer.candidates?.[offer.index ?? 0]?.title ?? ""}`;

  const body = response.response as {
    outputSpeech?: { text?: string };
    directives?: { type?: string; playBehavior?: string; audioItem?: { stream?: { url?: string; offsetInMilliseconds?: number }; metadata?: { title?: string; subtitle?: string } } }[];
  };
  if (body.outputSpeech?.text) fields.said = body.outputSpeech.text.slice(0, 200);
  const directive = body.directives?.[0];
  if (directive?.type === "AudioPlayer.Stop") fields.action = "stop";
  if (directive?.type === "AudioPlayer.Play") {
    fields.action = directive.playBehavior === "ENQUEUE" ? "queue" : "play";
    fields.videoId = directive.audioItem?.stream?.url?.match(/\/(?:video-)?audio\/([A-Za-z0-9_-]{11})/)?.[1];
    fields.title = directive.audioItem?.metadata?.title?.slice(0, 200);
    fields.by = directive.audioItem?.metadata?.subtitle?.slice(0, 100);
    const offset = Math.round((directive.audioItem?.stream?.offsetInMilliseconds ?? 0) / 1000);
    if (offset) fields.from = offset;
  }
  return fields;
}
