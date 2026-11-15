import { createContext, useContext } from "react";
import type { MusicTrack } from "./musicApi";

/** Extra rows for a song opened from Up next. */
export type MusicTrackMenuExtras = { onRemove?: () => void };
export type OpenMusicTrackMenu = (track: MusicTrack, extras?: MusicTrackMenuExtras) => void;
/** `label` names the ⋮ button that opens it. */
export type MusicTrackMenu = { open: OpenMusicTrackMenu; label: string };

export const MusicTrackMenuContext = createContext<MusicTrackMenu | null>(null);

/** Opens a song's menu (Play next, Add to queue, Not this one); null outside music mode. */
export function useMusicTrackMenu(): MusicTrackMenu | null {
  return useContext(MusicTrackMenuContext);
}
