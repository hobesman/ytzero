import { useSyncExternalStore } from "react";
import { phoneDownloadsNative } from "../phoneDownloadsNative";
import { MusicDownloadStore, type MusicDownloadsView } from "./musicDownloads";

/** The music saved on this phone; `available` is false on TVs and iOS. Actions go through this store. */
export const musicDownloads = new MusicDownloadStore(phoneDownloadsNative);

/** The current downloads, re-rendering on every change; read it with the `music…` helpers in musicDownloads.ts. */
export function useMusicDownloads(): MusicDownloadsView {
  return useSyncExternalStore(musicDownloads.subscribe, musicDownloads.view);
}
