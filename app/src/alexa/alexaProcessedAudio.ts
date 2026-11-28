import { alexaAudioLink, type AlexaAudioKind } from "./alexaAudioLinks";
import type { AudioCut, AudioPlan } from "./alexaAudioPlan";

/**
 * A song's or a video's audio with its plan applied (see alexaAudioPlan.ts),
 * through ffmpeg as books are: it starts at the place asked for (`t`, video
 * seconds), leaves out the cuts after it, turns the volume down, and writes
 * fragmented MP4. Signed like the plain file; `t` is free, as there.
 */
export function alexaProcessedAudioLink(publicUrl: string, secret: string, videoId: string, userId: number, now: number, startSeconds: number, kind: AlexaAudioKind): string {
  const link = new URL(alexaAudioLink(publicUrl, secret, videoId, userId, now, kind));
  link.pathname += "/processed";
  if (startSeconds > 0) link.searchParams.set("t", String(Math.round(startSeconds * 1000) / 1000));
  return link.href;
}

/** The cuts after `start`, measured from it, as ffmpeg sees time once it has seeked there. */
export function cutsFrom(cuts: readonly AudioCut[], start: number): AudioCut[] {
  return cuts.filter((cut) => cut.end > start).map((cut) => ({ start: Math.max(0, cut.start - start), end: cut.end - start }));
}

const BITRATE = "128k";
const seconds = (value: number) => String(Math.round(value * 1000) / 1000);

/** ffmpeg's filter for the plan from `start`: the cuts dropped and the timestamps closed up, then the volume. */
export function processedFilter(plan: AudioPlan, start: number): string | null {
  const filters: string[] = [];
  const cuts = cutsFrom(plan.cuts, start);
  if (cuts.length) {
    filters.push(`aselect='not(${cuts.map((cut) => `between(t,${seconds(cut.start)},${seconds(cut.end)})`).join("+")})'`, "asetpts=N/SR/TB");
  }
  if (plan.volumeDb < 0) filters.push(`volume=${Math.round(plan.volumeDb * 10) / 10}dB`);
  return filters.length ? filters.join(",") : null;
}

/** ffmpeg's arguments for the processed stream from `start` video seconds. The input link is signed: never log these. */
export function processedStreamArgs(inputUrl: string, start: number, plan: AudioPlan): string[] {
  const filter = processedFilter(plan, start);
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-reconnect", "1", "-reconnect_on_network_error", "1", "-reconnect_delay_max", "5",
    ...(start > 0 ? ["-ss", seconds(start)] : []),
    "-i", inputUrl,
    "-map", "0:a:0", "-vn", "-sn", "-dn",
    ...(filter ? ["-af", filter] : []),
    "-c:a", "aac", "-b:a", BITRATE,
    "-f", "mp4", "-movflags", "empty_moov+default_base_moof", "-frag_duration", "2000000",
    "pipe:1",
  ];
}
