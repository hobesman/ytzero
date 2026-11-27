import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppState, Linking, Platform } from "react-native";
import {
  RECHECK_BEFORE_ACTING_MS, downloadFraction, fetchLatestAndroidRelease, installedBuild, isUpdate, shouldDownloadInBackground, shouldRecheckBeforeActing, type AndroidRelease,
} from "./appUpdate";
import { appUpdateNative } from "./appUpdateNative";
import { deviceStore } from "./deviceStore";
import type { Translate } from "./i18n";

/** Only Android phones install the APK from GitHub; TVs and tvOS get theirs elsewhere. */
export const appUpdatesAvailable = Platform.OS === "android" && !Platform.isTV;

export type AppUpdateState =
  | { status: "checking" }
  | { status: "failed" }
  | { status: "current" }
  /** `problem`: why the last download or install stopped, shown until the next try. */
  | { status: "available"; release: AndroidRelease; problem?: "download" | "corrupt" }
  | { status: "downloading"; release: AndroidRelease; fraction: number | null; background: boolean }
  | { status: "ready"; release: AndroidRelease; problem?: "install" }
  /** Waiting for the user to allow YT Zero to install apps. */
  | { status: "permission"; release: AndroidRelease }
  | { status: "installing"; release: AndroidRelease };

/**
 * Whether new builds download by themselves (device-only, never sent to the
 * instance or backed up). Missing or invalid values mean on.
 */
export const AUTO_UPDATE_KEY = "ytzero.phone.auto-update";

const recheckAfterMs = 60 * 60 * 1000;
const native = appUpdateNative;
// One updater for the whole app, shared by the avatar menu and Settings. What
// it has found is kept in memory; the downloaded APK waits in the app's cache.
let state: AppUpdateState = { status: "checking" };
let auto = true;
let checkedAt = 0;
let running: Promise<void> | null = null;
let installPoll: ReturnType<typeof setInterval> | null = null;
let texts = { title: "", text: "", channel: "" };
const listeners = new Set<() => void>();

function set(next: AppUpdateState) {
  state = next;
  for (const listener of listeners) listener();
}
const notify = () => { for (const listener of listeners) listener(); };

/** This build installs updates itself: it has the native installer and GitHub listed the APK's checksum. */
const installsItself = (release: AndroidRelease) => Boolean(native && release.sha256);
const busy = () => state.status === "downloading" || state.status === "installing" || state.status === "permission";

/** Asks GitHub for the newest build, unless the last check is younger than `maxAgeMs`. */
async function refresh(maxAgeMs: number) {
  if (!appUpdatesAvailable || busy()) return;
  if (Date.now() - checkedAt < maxAgeMs) return;
  checkedAt = Date.now();
  // A found update stays on screen while it's checked again.
  if (state.status === "current" || state.status === "failed") set({ status: "checking" });
  let release: AndroidRelease | null;
  try { release = await fetchLatestAndroidRelease(); } catch {
    checkedAt = 0;
    if (state.status === "checking") set({ status: "failed" });
    return;
  }
  if (busy()) return;
  if (!isUpdate(release, installedBuild())) { set({ status: "current" }); return; }
  const same = (state.status === "available" || state.status === "ready") && state.release.build === release.build;
  if (!same) set(installsItself(release) && native!.isDownloaded(release.build) ? { status: "ready", release } : { status: "available", release });
  downloadInBackground();
}

function downloadInBackground() {
  if (state.status !== "available" || !native || !installsItself(state.release)) return;
  if (shouldDownloadInBackground({ auto, metered: native.isMetered(), idle: running === null })) void download(state.release, { background: true, thenInstall: false });
}

function download(release: AndroidRelease, options: { background: boolean; thenInstall: boolean }): Promise<void> {
  const work = (async () => {
    set({ status: "downloading", release, fraction: null, background: options.background });
    const timer = setInterval(() => {
      if (state.status === "downloading" && state.release.build === release.build) set({ ...state, fraction: downloadFraction(native!.progress()) });
    }, 500);
    let result: string;
    try { result = await native!.download(release.apkUrl, release.sha256!, release.build, options.background); } catch { result = "network"; }
    finally { clearInterval(timer); }
    if (result === "busy") return;
    if (result === "done") {
      set({ status: "ready", release });
      if (options.thenInstall) await install();
      return;
    }
    // A background download that stopped (mobile data, no network) tries again at the next check, quietly.
    set({ status: "available", release, problem: options.background || result === "cancelled" ? undefined : result === "corrupt" ? "corrupt" : "download" });
  })();
  running = work.finally(() => { running = null; });
  return running;
}

async function install() {
  if (!native || (state.status !== "ready" && state.status !== "permission")) return;
  const { release } = state;
  if (!native.canInstall()) {
    set({ status: "permission", release });
    native.openInstallPermission();
    return;
  }
  set({ status: "installing", release });
  await native.requestNotifications().catch(() => {});
  let result: string;
  try { result = await native.install(release.build, texts.title, texts.text, texts.channel); } catch { result = "failed"; }
  if (result === "missing") { set({ status: "available", release }); return; }
  if (result !== "started") { set({ status: "ready", release, problem: "install" }); return; }
  // Android shows its confirmation, or updates at once and stops this version. A cancelled or failed install is read back here.
  if (installPoll) clearInterval(installPoll);
  installPoll = setInterval(() => {
    const outcome = native.takeInstallResult();
    if (!outcome || state.status !== "installing") return;
    clearInterval(installPoll!); installPoll = null;
    set({ status: "ready", release, problem: outcome === "aborted" ? undefined : "install" });
  }, 1000);
}

let acting = false;

/**
 * A tap on the update row. A found or downloaded build is checked against
 * GitHub first (unless that was just done), so a newer build published since
 * replaces it; offline, the one already found goes ahead.
 */
async function act() {
  if (acting) return;
  acting = true;
  try {
    if (shouldRecheckBeforeActing(state.status, checkedAt, Date.now())) await refresh(0);
    await perform();
  } finally { acting = false; }
}

/** The one thing a tap on the update row does in each state. */
async function perform() {
  switch (state.status) {
    case "available":
      if (!installsItself(state.release)) { void Linking.openURL(state.release.apkUrl); return; }
      await download(state.release, { background: false, thenInstall: true });
      return;
    case "downloading": {
      if (!state.background) return;
      // The user wants it now: the background download gives way, and this one goes on over mobile data too.
      const { release } = state;
      native!.cancel();
      await running;
      await download(release, { background: false, thenInstall: true });
      return;
    }
    case "ready": await install(); return;
    case "permission":
      if (native!.canInstall()) await install(); else native!.openInstallPermission();
      return;
    default: void refresh(0);
  }
}

async function setAuto(value: boolean) {
  await deviceStore.setItemAsync(AUTO_UPDATE_KEY, value ? "1" : "0");
  auto = value;
  notify();
  if (value) downloadInBackground();
  else if (state.status === "downloading" && state.background) native?.cancel();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => state;
const autoSnapshot = () => auto;

/**
 * Runs the updater while the app is open: removes an installer the running
 * build has replaced, checks hourly and on returning to the app, downloads a
 * new build on Wi-Fi when that's on, and carries on once the user has allowed
 * installs. Mount once, at the app's root.
 */
export function useAppUpdatesInBackground() {
  useEffect(() => {
    if (!appUpdatesAvailable) return;
    try { native?.cleanup(); } catch {}
    let active = true;
    void deviceStore.getItemAsync(AUTO_UPDATE_KEY).then((value) => { if (active) { auto = value !== "0"; notify(); } }, () => {})
      .finally(() => { if (active) void refresh(recheckAfterMs); });
    const timer = setInterval(() => void refresh(recheckAfterMs), recheckAfterMs);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      if (state.status === "permission" && native?.canInstall()) void install();
      else void refresh(recheckAfterMs);
    });
    return () => { active = false; clearInterval(timer); subscription.remove(); };
  }, []);
}

export function useAppUpdate(t: Translate) {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const autoDownload = useSyncExternalStore(subscribe, autoSnapshot, autoSnapshot);
  // The new version posts this once it runs, so it's set while the old one still knows the language.
  useEffect(() => { texts = { title: t("updateNotifyTitle"), text: t("updateNotifyText"), channel: t("appUpdates") }; }, [t]);
  /** Checks GitHub unless that was done in the last minute; Settings calls it when it opens. */
  const check = useCallback(() => void refresh(RECHECK_BEFORE_ACTING_MS), []);
  const run = useCallback(() => void act(), []);
  const changeAuto = useCallback((value: boolean) => setAuto(value), []);
  return {
    state: current, installed: installedBuild(), autoDownload, check, act: run, setAutoDownload: changeAuto,
    /** Whether this build downloads and installs updates itself, rather than through the browser. */
    installsItself: current.status === "available" ? installsItself(current.release) : Boolean(native),
  };
}
