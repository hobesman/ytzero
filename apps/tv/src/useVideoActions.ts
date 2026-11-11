import { useCallback, useEffect, useMemo, useState } from "react";
import type { YtZeroApi } from "./api";
import { partlyWatched } from "./feedSections";
import type { Translate } from "./i18n";
import { SESSION_QUEUE_LIMIT } from "./playbackQueue";
import { useSessionQueue } from "./SessionQueue";
import type { Bucket, UserPlaylist, Video } from "./types";
import { visibleTvVideoCardActions, type TvVideoCardActionId, type VideoCardActionConfig } from "./videoCardActions";

/** A rewatch stopped part-way is still unfinished: its menu offers Mark watched, not Mark unwatched. */
export const fullyWatched = (video: Video): boolean => video.watched === 1 && !partlyWatched(video);

export type VideoActionView ="actions" | "schedule" | "playlists";
export type VideoActionItem = "channel" | TvVideoCardActionId;

export const scheduleBuckets: Array<{ bucket: Bucket; label: "scheduleToday" | "scheduleTonight" | "scheduleTomorrow" | "scheduleTomorrowEvening" | "scheduleWeekend" }> = [
  { bucket: "today", label: "scheduleToday" },
  { bucket: "tonight", label: "scheduleTonight" },
  { bucket: "tomorrow", label: "scheduleTomorrow" },
  { bucket: "tomorrow_evening", label: "scheduleTomorrowEvening" },
  { bucket: "weekend", label: "scheduleWeekend" },
];

/**
 * What a video's action menu offers and does, shared by the TV menu and the
 * phone sheet: it verifies the video's current state, then runs an action,
 * opens the schedule or playlist choices, and reports each change.
 */
export function useVideoActions({ api, actionConfig, video, onClose, onRemove, onVideoChange, t }: {
  api: YtZeroApi; actionConfig: VideoCardActionConfig; video: Video; t: Translate;
  onClose: () => void; onRemove?: () => Promise<void>; onVideoChange: (video: Video) => void;
}) {
  const queue = useSessionQueue();
  const queued = queue.items.some((item) => item.video_id === video.video_id);
  const [view, setView] = useState<VideoActionView>("actions");
  const [currentVideo, setCurrentVideo] = useState(video);
  const [playlists, setPlaylists] = useState<UserPlaylist[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [verifiedId, setVerifiedId] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState(false);
  const [metadataRequest, setMetadataRequest] = useState(0);
  useEffect(() => {
    let active = true;
    setVerifiedId(null);
    setMetadataError(false);
    void api.video(video.video_id).then((result) => {
      if (!active) return;
      setCurrentVideo(result.video);
      setVerifiedId(video.video_id);
    }).catch(() => { if (active) setMetadataError(true); });
    return () => { active = false; };
  }, [api, video.video_id, metadataRequest]);

  const close = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  const goBack = useCallback(() => {
    if (busy) return;
    if (view === "actions") close();
    else { setError(false); setView("actions"); }
  }, [busy, close, view]);

  const actions = useMemo(
    () => visibleTvVideoCardActions(actionConfig, currentVideo, Boolean(onRemove), queued),
    [actionConfig, currentVideo, onRemove, queued],
  );

  const updateVideo = useCallback((next: Video) => {
    setCurrentVideo(next);
    onVideoChange(next);
  }, [onVideoChange]);

  const run = useCallback(async (id: string, action: () => Promise<void>, closeAfter = true) => {
    if (busy) return;
    setBusy(id);
    setError(false);
    try {
      await action();
      if (closeAfter) onClose();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }, [busy, onClose]);

  const openPlaylists = useCallback(() => {
    if (busy) return;
    setView("playlists");
    setPlaylists(null);
    setError(false);
    void api.userPlaylists(currentVideo.video_id)
      .then((result) => setPlaylists(result.playlists))
      .catch(() => {
        setPlaylists([]);
        setError(true);
      });
  }, [api, busy, currentVideo]);

  const selectAction = useCallback((id: TvVideoCardActionId) => {
    if (busy || verifiedId !== currentVideo.video_id || !actions.includes(id)) return;
    if (id === "sessionQueue") {
      if (queued) queue.remove(currentVideo.video_id);
      else if (queue.items.length < SESSION_QUEUE_LIMIT) queue.add(currentVideo);
      else return;
      onClose();
      return;
    }
    if (id === "schedule") {
      setError(false);
      setView("schedule");
      return;
    }
    if (id === "playlist") return openPlaylists();
    if (id === "download") {
      const active = currentVideo.download_status === "queued" || currentVideo.download_status === "downloading";
      void run(id, async () => {
        if (active) await api.cancelVideoDownload(currentVideo.video_id);
        else await api.downloadVideo(currentVideo.video_id);
        updateVideo({ ...currentVideo, download_status: active ? null : "queued" });
      });
      return;
    }
    if (id === "archive") {
      void run(id, async () => {
        await api.reject(currentVideo.video_id);
        updateVideo({ ...currentVideo, status: "archived", bucket: null });
      });
      return;
    }
    if (id === "restore") {
      void run(id, async () => {
        await api.restore(currentVideo.video_id);
        updateVideo({ ...currentVideo, status: "inbox", bucket: null });
      });
      return;
    }
    if (id === "remove" && onRemove) {
      void run(id, onRemove);
      return;
    }
    const watched = fullyWatched(currentVideo);
    void run(id, async () => {
      if (watched) {
        await api.markUnwatched(currentVideo.video_id);
        updateVideo({ ...currentVideo, watched: 0, watch_position: null, watch_duration: null });
      } else {
        await api.markWatched(currentVideo.video_id);
        await api.reject(currentVideo.video_id);
        // The server counts a partial watch as finished (videoCompletion.ts).
        updateVideo({ ...currentVideo, watched: 1, status: "archived", bucket: null,
          watch_position: currentVideo.watch_duration ?? currentVideo.watch_position });
      }
    });
  }, [actions, api, busy, currentVideo, onClose, onRemove, openPlaylists, queue, queued, run, updateVideo, verifiedId]);

  const chooseSchedule = useCallback((bucket: Bucket) => {
    if (busy) return;
    const remove = currentVideo.status === "queued" && currentVideo.bucket === bucket;
    void run(`schedule-${bucket}`, async () => {
      if (remove) await api.dequeue(currentVideo.video_id);
      else await api.queue(currentVideo.video_id, bucket);
      updateVideo({
        ...currentVideo,
        status: remove ? "inbox" : "queued",
        bucket: remove ? null : bucket,
      });
    });
  }, [api, busy, currentVideo, run, updateVideo]);

  const togglePlaylist = useCallback((playlist: UserPlaylist, value: boolean) => {
    if (busy) return;
    void run(`playlist-${playlist.id}`, async () => {
      if (value) await api.addVideoToUserPlaylist(playlist.id, currentVideo.video_id);
      else await api.removeVideoFromUserPlaylist(playlist.id, currentVideo.video_id);
      setPlaylists((items) => items?.map((item) => item.id === playlist.id ? {
        ...item,
        has_video: value ? 1 : 0,
        video_count: Math.max(0, item.video_count + (value ? 1 : -1)),
      } : item) ?? items);
    }, false);
  }, [api, busy, currentVideo, run]);

  const actionLabel = (id: TvVideoCardActionId): string => {
    switch (id) {
      case "sessionQueue": return t(queued ? "removeFromQueue" : queue.items.length >= SESSION_QUEUE_LIMIT ? "queueFull" : "addToQueue");
      case "schedule": return t("scheduleVideo");
      case "playlist": return t("addToPlaylist");
      case "download": return currentVideo.download_status === "queued" || currentVideo.download_status === "downloading" ? t("cancelDownload") : t("downloadVideo");
      case "archive": return t("reject");
      case "watched": return fullyWatched(currentVideo) ? t("markUnwatched") : t("markWatched");
      case "restore": return t("restoreVideo");
      case "remove": return t("removeFromHistory");
    }
  };
  const mainItems: VideoActionItem[] = [
    ...(currentVideo.channel_id ? ["channel" as const] : []),
    ...actions,
  ];
  const queueFull = !queued && queue.items.length >= SESSION_QUEUE_LIMIT;
  return {
    view, currentVideo, playlists, busy, error, verified: verifiedId === currentVideo.video_id, metadataError, queued, queueFull,
    mainItems, close, goBack, selectAction, chooseSchedule, togglePlaylist, actionLabel,
    retryMetadata: () => setMetadataRequest((request) => request + 1),
  };
}
