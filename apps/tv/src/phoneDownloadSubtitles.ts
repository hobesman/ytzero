import { matchSubtitleTrack, subtitleMemory, type SubtitleTrack } from "./subtitles";
import type { Video } from "./types";

/**
 * Subtitles saved with a phone download, so a downloaded video has them
 * offline too. A video can list a hundred machine-translated tracks, so only
 * the languages this viewer is likely to want are saved: the last one picked
 * in the player, the channel's caption language, and the profile's caption and
 * interface languages. Device-only, like the video file beside them.
 */
export type SavedSubtitle = { lang: string; label: string; file: string };

/** At most this many tracks per video. */
export const SAVED_SUBTITLE_LIMIT = 3;

export type SubtitleSource = {
  videoSubtitles?(id: string): Promise<{ subtitles: SubtitleTrack[]; available?: Array<{ lang: string; label: string }> }>;
  settings?(): Promise<{ settings: { player_cc_lang?: string; player_hl?: string } }>;
};

/** The tracks to save, in order of preference, with no language twice. */
export function subtitlesToSave(tracks: readonly SubtitleTrack[], preferred: ReadonlyArray<string | null | undefined>): SubtitleTrack[] {
  const chosen: SubtitleTrack[] = [];
  for (const language of preferred) {
    const track = matchSubtitleTrack(tracks, language);
    if (track && !chosen.includes(track)) chosen.push(track);
    if (chosen.length >= SAVED_SUBTITLE_LIMIT) break;
  }
  return chosen;
}

/** A file name for one track, beside the video's own files. */
export function savedSubtitleFile(base: string, lang: string): string {
  return `${base}.${lang.replace(/[^A-Za-z0-9_-]/g, "_")}.vtt`;
}

/**
 * Fetches the chosen tracks into the download folder. Returns what was saved;
 * a track that fails is left out, and none of it stops the video's download.
 */
export async function saveDownloadSubtitles(options: {
  api: SubtitleSource; video: Video; base: string; instanceUrl: string; headers: Record<string, string>;
  fetchFile: (url: string, headers: Record<string, string>, name: string) => Promise<number>;
}): Promise<SavedSubtitle[]> {
  const { api, video, base, instanceUrl, headers, fetchFile } = options;
  if (!api.videoSubtitles) return [];
  const [list, settings] = await Promise.all([
    api.videoSubtitles(video.video_id).catch(() => null),
    api.settings ? api.settings().then((value) => value.settings, () => null) : Promise.resolve(null),
  ]);
  if (!list?.subtitles?.length) return [];
  const remembered = subtitleMemory();
  const tracks = subtitlesToSave(list.subtitles, [
    remembered === "off" ? null : remembered, video.channel_caption_language, settings?.player_cc_lang, settings?.player_hl,
  ]);
  const labels = new Map((list.available ?? []).map((item) => [item.lang, item.label]));
  const saved: SavedSubtitle[] = [];
  for (const track of tracks) {
    const file = savedSubtitleFile(base, track.lang);
    const url = new URL(track.url, `${instanceUrl.replace(/\/+$/, "")}/`).toString();
    const size = await fetchFile(url, headers, file).catch(() => -1);
    if (size > 0) saved.push({ lang: track.lang, label: track.label || labels.get(track.lang) || track.lang, file });
  }
  return saved;
}

/** Valid saved entries from an index file; anything malformed is dropped. */
export function parseSavedSubtitles(value: unknown): SavedSubtitle[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is SavedSubtitle => typeof item?.lang === "string" && typeof item.label === "string"
    && typeof item.file === "string" && /^[A-Za-z0-9_.-]+\.vtt$/.test(item.file));
}
