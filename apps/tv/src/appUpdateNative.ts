/** The phone app installing its own updates; see appUpdateNative.android.ts and modules/ytzero-app-update. */
export type AppUpdateDownloadResult = "done" | "metered" | "network" | "corrupt" | "cancelled" | "busy";
export type AppUpdateInstallResult = "started" | "missing" | "failed";
/** How an install that didn't update the app ended. */
export type AppUpdateInstallOutcome = "aborted" | "storage" | "incompatible" | "failed";

export type AppUpdateNative = {
  isMetered(): boolean;
  canInstall(): boolean;
  openInstallPermission(): void;
  isDownloaded(build: number): boolean;
  progress(): { build: number; downloaded: number; total: number };
  cancel(): void;
  cleanup(): void;
  takeInstallResult(): AppUpdateInstallOutcome | null;
  download(url: string, sha256: string, build: number, wifiOnly: boolean): Promise<AppUpdateDownloadResult>;
  requestNotifications(): Promise<unknown>;
  install(build: number, title: string, text: string, channelName: string): Promise<AppUpdateInstallResult>;
};

/** Other platforms: no native installer, so updates open in the browser. */
export const appUpdateNative: AppUpdateNative | null = null;
