import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { api, type Video } from "../api";
import { subscribeServerEvent } from "../serverEvents";

type DeviceDownloadController = {
  video: Video | null;
  requestDownload: (keep?: boolean, device?: boolean) => void;
  setVideo: Dispatch<SetStateAction<Video | null>>;
} | null;

function saveToDevice(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * "Download to your device". The server fetches the video first; once the
 * file is ready it is handed to the browser's downloads. A device-only request
 * keeps no server copy: the server releases it after the transfer, and this
 * hook then clears the stale "done" state so the page stops offering the file.
 */
export function useDeviceDownload(controller: DeviceDownloadController) {
  const video = controller?.video ?? null;
  const videoId = video?.video_id;
  const status = video?.download_status ?? null;
  const requestedRef = useRef<string | null>(null);
  const previousRef = useRef<{ videoId?: string; status: string | null }>({ status: null });
  const deviceOnly = !!videoId && video?.download_source === "device";
  const setVideo = controller?.setVideo;

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { videoId, status };
    const asked = !!videoId && requestedRef.current === videoId;
    if (!videoId || !setVideo || status !== "done" || !(deviceOnly || asked)) return;
    // Hand the file over when the viewer asked here, or when this page saw a
    // device-only download (asked before a reload) finish.
    const finishedHere = previous.videoId === videoId && previous.status !== "done";
    if (!finishedHere && !asked) return;
    requestedRef.current = null;
    saveToDevice(api.downloadFileUrl(videoId));
    const refresh = () => api.videoDownload(videoId).then((result) => {
      if (result.download) return;
      setVideo((prev) => prev?.video_id === videoId ? { ...prev, download_status: null, download_source: null } : prev);
    }).catch(() => {});
    return subscribeServerEvent("downloads", (data) => {
      if (!data?.videoId || data.videoId === videoId) refresh();
    });
  }, [videoId, status, deviceOnly, setVideo]);

  const requestDeviceDownload = () => {
    if (!videoId || !controller) return;
    requestedRef.current = videoId;
    controller.requestDownload(false, true);
    // The server keeps an existing server copy; until a reload says so, the
    // page treats the request as device-only, which is what was asked for.
    controller.setVideo((prev) => prev?.video_id === videoId ? { ...prev, download_source: prev.download_source ?? "device" } : prev);
  };

  return { deviceOnly, requestDeviceDownload };
}
