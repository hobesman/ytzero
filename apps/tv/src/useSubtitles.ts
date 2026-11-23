import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoPlayer } from "expo-video";
import type { YtZeroApi } from "./api";
import { deviceStore } from "./deviceStore";
import {
  activeSubtitleLines, defaultSubtitleTrack, loadSubtitleMemory, orderSubtitleTracks, parseSubtitles, saveSubtitleMemory, subtitleMemory,
  type SubtitleCues, type SubtitleTrack,
} from "./subtitles";
import type { TvProfileSettings, Video } from "./types";

/** How often the shown cue follows the player: often enough that a line lands with its words. */
const TICK_MS = 200;
/** Parsed tracks kept for this app run, so a revisit or a retry does not fetch again. */
const CACHE_LIMIT = 6;
const cache = new Map<string, Promise<SubtitleCues>>();

function cachedCues(api: YtZeroApi, url: string): Promise<SubtitleCues> {
  const key = `${api.instanceUrl}|${url}`;
  let cues = cache.get(key);
  if (!cues) {
    cues = api.subtitleText(url).then(parseSubtitles);
    // A failed fetch is tried again next time.
    cues.catch(() => { if (cache.get(key) === cues) cache.delete(key); });
    cache.set(key, cues);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  }
  return cues;
}

export type SubtitleState = {
  /** The video's tracks, the profile's languages first, each with a label to show. */
  tracks: Array<SubtitleTrack & { label: string }>;
  /** The language showing, or null for off. */
  selected: string | null;
  lines: string[];
  /** The chosen track could not be read. */
  failed: boolean;
  select: (language: string | null) => void;
};

/**
 * Subtitles for the video playing in `player`: lists its tracks, starts with the
 * profile's or the viewer's remembered language, and follows the player's time.
 * The player's time is read each tick, so seeks, quality changes and source
 * swaps need nothing of their own: a cue is chosen from the time alone.
 */
export function useSubtitles({ api, player, video, settings, enabled }: {
  api: YtZeroApi; player: VideoPlayer | null; video: Video | null; settings: TvProfileSettings | null | undefined; enabled: boolean;
}): SubtitleState {
  const [tracks, setTracks] = useState<SubtitleState["tracks"]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [cues, setCues] = useState<SubtitleCues | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const latestSettings = useRef(settings);
  latestSettings.current = settings;
  const videoId = enabled && video && video.live_status !== "live" ? video.video_id : null;
  const channel = useRef(video);
  channel.current = video;

  useEffect(() => {
    setTracks([]);
    setSelected(null);
    setFailed(false);
    if (!videoId) return;
    const controller = new AbortController();
    void Promise.all([api.videoSubtitles(videoId, controller.signal), loadSubtitleMemory(deviceStore)]).then(([result]) => {
      if (controller.signal.aborted) return;
      const labels = new Map((result.available ?? []).map((item) => [item.lang, item.label]));
      const profile = latestSettings.current;
      const listed = orderSubtitleTracks(result.subtitles ?? [], [profile?.player_cc_lang, profile?.player_hl])
        .map((track) => ({ ...track, label: track.label || labels.get(track.lang) || track.lang }));
      setTracks(listed);
      const current = channel.current;
      setSelected(defaultSubtitleTrack(listed, {
        channelMode: current?.channel_caption_mode, channelLanguage: current?.channel_caption_language,
        playerCc: profile?.player_cc, playerCcLang: profile?.player_cc_lang, playerHl: profile?.player_hl,
        remembered: subtitleMemory(),
      })?.lang ?? null);
    }).catch(() => {});
    return () => controller.abort();
  }, [api, videoId]);

  const url = tracks.find((track) => track.lang === selected)?.url ?? null;
  useEffect(() => {
    setCues(null);
    setLines([]);
    setFailed(false);
    if (!url) return;
    let current = true;
    cachedCues(api, url).then((parsed) => { if (current) setCues(parsed); }, () => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [api, url]);

  useEffect(() => {
    if (!cues || !player) return;
    let shown = "";
    let last = 0;
    const tick = () => {
      let time: number;
      try { time = player.currentTime; } catch { return; }
      // A reloading source reports 0 for a moment before it seeks back: keep the line.
      if (!(time > 0) && last > 1) return;
      last = time;
      const next = activeSubtitleLines(cues, time);
      const key = next.join("\n");
      if (key !== shown) { shown = key; setLines(next); }
    };
    tick();
    const interval = setInterval(tick, TICK_MS);
    return () => { clearInterval(interval); setLines([]); };
  }, [cues, player]);

  const select = useCallback((language: string | null) => {
    setSelected(language);
    void saveSubtitleMemory(deviceStore, language ?? "off").catch(() => {});
  }, []);

  return { tracks, selected: videoId ? selected : null, lines: videoId ? lines : [], failed, select };
}
