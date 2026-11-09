import { useEffect } from "react";
import { AppState } from "react-native";
import type { YtZeroApi } from "./api";
import { localProgress } from "./storage";

/**
 * Scopes the device's unsynced watch positions to the signed-in instance and
 * profile, and sends them to the server on sign-in and whenever the app returns
 * to the foreground (after a crash, a killed background process or a failed save).
 */
export function useLocalProgressSync(api: YtZeroApi | null, profileId: number | null | undefined) {
  useEffect(() => {
    if (!api || profileId == null) { localProgress.setOwner(null); return; }
    localProgress.setOwner(`${api.instanceUrl}#${profileId}`);
    const sync = () => void localProgress.flush((videoId, value) => api.savePlaybackProgress(videoId, value)).catch(() => {});
    sync();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") sync(); });
    return () => subscription.remove();
  }, [api, profileId]);
}
