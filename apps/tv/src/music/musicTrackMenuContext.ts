import { createContext, useContext } from "react";
import type { MusicTrack } from "./musicApi";

/** Extra rows for a song opened from Up next. */
export type MusicTrackMenuExtras = { onRemove?: () => void };
export type OpenMusicTrackMenu = (track: MusicTrack, extras?: MusicTrackMenuExtras) => void;
/** Opens the "Add to playlist" sheet for songs; `excludeId` is the playlist they come from. */
export type AddToMusicPlaylist = (tracks: MusicTrack[], excludeId?: string) => void;
/** `label` names the ⋮ button that opens it. */
export type MusicTrackMenu = { open: OpenMusicTrackMenu; label: string; addToPlaylist?: AddToMusicPlaylist };

export const MusicTrackMenuContext = createContext<MusicTrackMenu | null>(null);

/** Opens a song's menu (Play next, Add to queue, Add to playlist, Not this one); null outside music mode. */
export function useMusicTrackMenu(): MusicTrackMenu | null {
  return useContext(MusicTrackMenuContext);
}
