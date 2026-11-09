import { useEffect, useRef } from "react";
import type { VideoPlayer } from "expo-video";
import type { YtZeroApi } from "./api";
import { fetchSponsorSegments, segmentAt, type SponsorSegment } from "./sponsorBlock";
import type { Video } from "./types";

type Options = {
  api: Pick<YtZeroApi, "recordSponsorBlockSkip">;
  player: VideoPlayer | null; video: Video | null;
  /** The profile's categories; null when skipping is off. */
  categories: string[] | null;
  /** Count skips in Pulse (not in incognito). */
  record: boolean;
  onSkip: (seconds: number) => void;
};

/** Skips the profile's SponsorBlock segments in the playing video, as the web player does. */
export function useSponsorBlock({ api, player, video, categories, record, onSkip }: Options): void {
  const onSkipRef = useRef(onSkip);
  onSkipRef.current = onSkip;
  const videoId = video?.video_id ?? null;
  const live = video?.live_status === "live";
  const categoryKey = categories?.join(",") ?? "";
  useEffect(() => {
    if (!player || !videoId || live || !categoryKey) return;
    const controller = new AbortController();
    const recorded = new Set<string>();
    let segments: SponsorSegment[] = [];
    const check = (position: number) => {
      if (!player.playing) return;
      const segment = segmentAt(segments, position);
      if (!segment) return;
      const skipped = segment.segment[1] - position;
      player.currentTime = segment.segment[1];
      onSkipRef.current(skipped);
      if (!record || recorded.has(segment.UUID)) return;
      recorded.add(segment.UUID);
      void api.recordSponsorBlockSkip(videoId, segment, skipped).catch(() => recorded.delete(segment.UUID));
    };
    void fetchSponsorSegments(videoId, categoryKey.split(","), controller.signal)
      .then((value) => { if (!controller.signal.aborted) { segments = value; check(player.currentTime); } })
      .catch(() => {});
    const subscription = player.addListener("timeUpdate", ({ currentTime }) => check(currentTime));
    return () => { controller.abort(); subscription.remove(); };
  }, [api, categoryKey, live, player, record, videoId]);
}
