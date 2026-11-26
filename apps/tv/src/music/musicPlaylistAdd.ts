import type { Translate } from "../i18n";

export type PlaylistAddResult = { added: number; present: number; full: number; unknown: number };

/**
 * What to tell the user after adding several songs (an album or a playlist)
 * to one of their playlists. `songs` formats a song count ("3 songs").
 */
export function playlistAddNotice(result: PlaylistAddResult, name: string, t: Translate, songs: (count: number) => string): string {
  const fill = (text: string) => text.replace("{name}", name).replace("{songs}", songs(result.added)).replace("{already}", songs(result.present));
  if (result.full) return fill(t("musicPlaylistFullPartly"));
  if (!result.added) return result.present ? fill(t("musicAlreadyInPlaylist")) : t("musicActionFailed");
  return fill(t(result.present ? "musicAddedSongsSomeThere" : "musicAddedSongsToPlaylist"));
}
