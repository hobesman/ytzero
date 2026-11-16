import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import type { AppUpdateNative } from "./appUpdateNative";

export type { AppUpdateDownloadResult, AppUpdateInstallOutcome, AppUpdateInstallResult, AppUpdateNative } from "./appUpdateNative";

/** Android phones only; a build made before the module existed has none and falls back to the browser. */
export const appUpdateNative: AppUpdateNative | null = Platform.isTV ? null : requireOptionalNativeModule<AppUpdateNative>("YtZeroAppUpdate");
