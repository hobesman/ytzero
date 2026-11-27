import type { Translate } from "../i18n";
import { PhoneChip } from "../phone/PhoneChip";
import type { MusicTrack } from "./musicApi";
import { useMusicTrackMenu } from "./musicTrackMenuContext";

/** An album's or playlist's "Add to playlist" chip, adding all its songs; left out where music mode can't add (offline). */
export function MusicAddAllToPlaylistChip({ t, tracks, excludeId }: { t: Translate; tracks: MusicTrack[]; excludeId?: string }) {
  const add = useMusicTrackMenu()?.addToPlaylist;
  if (!add) return null;
  return <PhoneChip label={t("musicAddToPlaylist")} disabled={!tracks.length} onPress={() => add(tracks, excludeId)} />;
}
