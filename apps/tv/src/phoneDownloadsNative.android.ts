import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import type { PhoneDownloadsNative } from "./phoneDownloadsNative";

export type { NativeDownloadStatus, PhoneDownloadsNative } from "./phoneDownloadsNative";

/** Android phones only: TVs keep no downloads of their own. */
export const phoneDownloadsNative: PhoneDownloadsNative | null = Platform.isTV ? null : requireOptionalNativeModule<PhoneDownloadsNative>("YtZeroPhoneDownloads");
