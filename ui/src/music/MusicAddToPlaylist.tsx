import { useEffect, useState, type FormEvent } from "react";
import { ListMusic, ListPlus, Plus } from "lucide-react";
import { emitToast } from "../events";
import { formatSongCount, useI18n } from "../i18n";
import { Button, Dialog, Field, IconButton, Input, Menu, MenuItem, MenuLoading, MenuSeparator } from "../components/ui";
import { musicApi, type MusicTrack, type MusicUserPlaylist } from "./musicApi";

/** Asks for a playlist's name: creating one, or renaming it. */
export function MusicPlaylistNameDialog({ open, title, submitLabel, initial = "", onOpenChange, onSubmit }: {
  open: boolean; title: string; submitLabel: string; initial?: string; onOpenChange: (open: boolean) => void; onSubmit: (name: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setName(initial); }, [initial, open]);
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(name.trim());
      onOpenChange(false);
    } catch { emitToast(t("musicActionFailed"), "danger"); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange} title={title} closeLabel={t("close")} busy={busy}
    footer={<><Button onClick={() => onOpenChange(false)}>{t("cancel")}</Button><Button variant="primary" disabled={!name.trim() || busy} onClick={() => void submit()}>{submitLabel}</Button></>}>
    <form onSubmit={(event) => void submit(event)}>
      <Field label={t("playlistName")} htmlFor="music-playlist-name">
        <Input id="music-playlist-name" autoFocus maxLength={150} value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
    </form>
  </Dialog>;
}

/** A "New playlist" dialog; the playlist it creates goes to `onCreated`. */
export function useCreateMusicPlaylist(onCreated: (playlist: MusicUserPlaylist) => void) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const dialog = <MusicPlaylistNameDialog open={open} onOpenChange={setOpen} title={t("newPlaylist")} submitLabel={t("create")}
    onSubmit={async (name) => onCreated(await musicApi.createPlaylist(name))} />;
  return { open: () => setOpen(true), dialog };
}

type I18n = ReturnType<typeof useI18n>;

/** Adds one song, or several in order (an album or a playlist), to a playlist and says how it went. */
export async function addTracksToPlaylist(tracks: readonly MusicTrack[], playlist: MusicUserPlaylist, { t, language }: I18n) {
  const name = playlist.title;
  try {
    if (tracks.length === 1) {
      const { added } = await musicApi.addToPlaylist(playlist.id, tracks[0].videoId);
      emitToast(t(added ? "musicAddedToPlaylist" : "musicAlreadyInPlaylist", { name }), added ? "success" : "default");
      return;
    }
    const result = await musicApi.addManyToPlaylist(playlist.id, tracks.map((track) => track.videoId));
    const songs = formatSongCount(result.added, language);
    if (result.full) emitToast(t("musicPlaylistFullPartly", { songs, name }), "default");
    else if (!result.added) emitToast(result.present ? t("musicAlreadyInPlaylist", { name }) : t("musicActionFailed"), result.present ? "default" : "danger");
    else if (result.present) emitToast(t("musicAddedSongsSomeThere", { songs, name, already: formatSongCount(result.present, language) }), "success");
    else emitToast(t("musicAddedSongsToPlaylist", { songs, name }), "success");
  } catch { emitToast(t("musicActionFailed"), "danger"); }
}

/**
 * "Add to playlist" for one song or several: the profile's playlists and "New
 * playlist", in a sheet that docks to the bottom of a phone screen. `open()`
 * shows it; render `element` where it can outlive a menu that opened it.
 * `excludeId` leaves out the playlist the songs come from.
 */
export function useAddToMusicPlaylist(tracks: readonly MusicTrack[], excludeId?: string) {
  const i18n = useI18n();
  const { t } = i18n;
  const [open, setOpen] = useState(false);
  const [playlists, setPlaylists] = useState<MusicUserPlaylist[] | null>(null);
  const create = useCreateMusicPlaylist((playlist) => void addTracksToPlaylist(tracks, playlist, i18n));
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPlaylists(null);
    musicApi.myPlaylists().then((list) => { if (live) setPlaylists(list); }, () => { if (live) setPlaylists([]); });
    return () => { live = false; };
  }, [open]);
  const choices = playlists?.filter((playlist) => playlist.id !== excludeId) ?? null;
  const choose = (playlist: MusicUserPlaylist) => { setOpen(false); void addTracksToPlaylist(tracks, playlist, i18n); };
  const element = <>
    <Dialog variant="sheet" open={open} onOpenChange={setOpen} title={t("musicAddToPlaylist")} closeLabel={t("close")}>
      <Menu>
        {choices === null ? <MenuLoading label={t("loading")} /> : choices.map((playlist) =>
          <MenuItem key={playlist.id} icon={<ListMusic />} onClick={() => choose(playlist)}>{playlist.title}</MenuItem>)}
        {choices?.length ? <MenuSeparator /> : null}
        <MenuItem icon={<Plus />} onClick={() => { setOpen(false); create.open(); }}>{t("newPlaylist")}</MenuItem>
      </Menu>
    </Dialog>
    {create.dialog}
  </>;
  return { open: () => setOpen(true), element };
}

/** The player bar's "Add to playlist" button for the song that is playing. */
export function MusicAddToPlaylistButton({ track }: { track: MusicTrack }) {
  const { t } = useI18n();
  const add = useAddToMusicPlaylist([track]);
  return <>
    <IconButton variant="ghost" label={t("musicAddToPlaylist")} icon={<ListPlus />} onClick={add.open} />
    {add.element}
  </>;
}

/** An album's or playlist's "Add to playlist" button, adding all its songs. */
export function MusicAddAllToPlaylistButton({ tracks, excludeId }: { tracks: readonly MusicTrack[]; excludeId?: string }) {
  const { t } = useI18n();
  const add = useAddToMusicPlaylist(tracks, excludeId);
  return <>
    <Button leadingIcon={<ListPlus />} disabled={!tracks.length} onClick={add.open}>{t("musicAddToPlaylist")}</Button>
    {add.element}
  </>;
}
