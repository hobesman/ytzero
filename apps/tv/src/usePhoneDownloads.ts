import { useSyncExternalStore } from "react";
import { PhoneDownloadStore, type PhoneDownloadsView } from "./phoneDownloads";
import { phoneDownloadsNative } from "./phoneDownloadsNative";

/** The phone's downloads; `available` is false on TVs and iOS. Actions go through this store. */
export const phoneDownloads = new PhoneDownloadStore(phoneDownloadsNative);

/** The current downloads, re-rendering on every change; read it with the `view…` helpers. */
export function usePhoneDownloads(): PhoneDownloadsView {
  return useSyncExternalStore(phoneDownloads.subscribe, phoneDownloads.view);
}
