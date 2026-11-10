import { useSyncExternalStore } from "react";
import { PhoneDownloadStore } from "./phoneDownloads";
import { phoneDownloadsNative } from "./phoneDownloadsNative";

/** The phone's downloads; `available` is false on TVs and iOS. */
export const phoneDownloads = new PhoneDownloadStore(phoneDownloadsNative);

/** Re-renders when any download changes. */
export function usePhoneDownloads(): PhoneDownloadStore {
  useSyncExternalStore(phoneDownloads.subscribe, phoneDownloads.getVersion);
  return phoneDownloads;
}
