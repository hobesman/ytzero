import { useCallback, useEffect, useState } from "react";
import { Linking, Platform } from "react-native";
import { fetchLatestAndroidRelease, installedBuild, isUpdate, type AndroidRelease } from "./appUpdate";

/** Only Android phones install the APK from GitHub; TVs and tvOS get theirs elsewhere. */
export const appUpdatesAvailable = Platform.OS === "android" && !Platform.isTV;

export type AppUpdateState =
  | { status: "checking" }
  | { status: "failed" }
  | { status: "current" }
  | { status: "available"; release: AndroidRelease };

const recheckAfterMs = 60 * 60 * 1000;
// One check per hour for the whole app, shared by the avatar menu and Settings.
// Kept in memory only: nothing about updates is stored on the device.
let cached: { at: number; result: Promise<AndroidRelease | null> } | null = null;

function latest(force: boolean): Promise<AndroidRelease | null> {
  if (force || !cached || Date.now() - cached.at > recheckAfterMs) {
    const result = fetchLatestAndroidRelease();
    cached = { at: Date.now(), result };
    result.catch(() => { if (cached?.result === result) cached = null; });
  }
  return cached.result;
}

export function useAppUpdate(): { state: AppUpdateState; installed: number | null; check: () => void; install: () => void } {
  const [state, setState] = useState<AppUpdateState>({ status: "checking" });
  const [request, setRequest] = useState(0);
  useEffect(() => {
    if (!appUpdatesAvailable) return;
    let active = true;
    setState({ status: "checking" });
    latest(request > 0).then((release) => {
      if (active) setState(isUpdate(release, installedBuild()) ? { status: "available", release } : { status: "current" });
    }, () => { if (active) setState({ status: "failed" }); });
    return () => { active = false; };
  }, [request]);
  const check = useCallback(() => setRequest((value) => value + 1), []);
  // The browser downloads the APK; opening the download hands it to the system installer.
  const install = useCallback(() => {
    if (state.status === "available") void Linking.openURL(state.release.apkUrl);
  }, [state]);
  return { state, installed: installedBuild(), check, install };
}
