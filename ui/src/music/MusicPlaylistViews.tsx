import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronDown, ChevronUp, ListMusic, ListPlus, Pencil, Play, Plus, Shuffle, Trash2, X } from "lucide-react";
import { emitToast } from "../events";
import { formatSongCount, useI18n } from "../i18n";
import Popconfirm from "../components/Popconfirm";
import { Button, Dialog, EmptyState, Field, IconButton, Input, Menu, MenuItem, MenuLoading, MenuSeparator, Popover } from "../components/ui";
import { musicApi, type MusicTrack, type MusicUserPlaylist, type MusicUserPlaylistPage } from "./musicApi";
import { MusicArtwork, MusicDetailHeader, MusicNote, MusicTrackList, durationLabel, useMusicData } from "./MusicParts";
import { musicPlayer, useMusicPlayer } from "./musicPlayer";
import { current } from "./musicQueue";
import "./MusicPlaylistViews.css";

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

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** One of the profile's own playlists: play it, rename or delete it, and reorder or remove its songs. */
export function MusicUserPlaylistView() {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const page = useMusicData(useCallback(() => musicApi.myPlaylist(id), [id]));
  const playingId = current(useMusicPlayer().queue)?.videoId ?? null;
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const playlist = page.data;
  if (page.failed && !playlist) return <MusicNote text={t("musicPageFailed")} onRetry={page.retry} />;
  if (!playlist) return null;
  const update = (next: MusicUserPlaylistPage, request: Promise<unknown>) => {
    page.setData(next);
    request.catch(() => { emitToast(t("musicActionFailed"), "danger"); page.retry(); });
  };
  const move = (from: number, to: number) => {
    const tracks = moved(playlist.tracks, from, to);
    update({ ...playlist, tracks }, musicApi.reorderPlaylist(playlist.id, tracks.map((track) => track.videoId)));
  };
  const remove = (track: MusicTrack) => update({ ...playlist, tracks: playlist.tracks.filter((entry) => entry.videoId !== track.videoId), trackCount: playlist.trackCount - 1 },
    musicApi.removeFromPlaylist(playlist.id, track.videoId));
  const play = (options: { shuffle?: boolean; startAt?: string } = {}) => musicPlayer.playTracks(playlist.tracks, { from: playlist.title, ...options });
  const deleteThis = async () => {
    try {
      await musicApi.deletePlaylist(playlist.id);
      navigate("/music/library", { replace: true });
    } catch { emitToast(t("musicActionFailed"), "danger"); }
  };
  const empty = !playlist.tracks.length;
  return <>
    <MusicDetailHeader art={playlist.thumbnail || null} title={playlist.title} detail={formatSongCount(playlist.tracks.length, language)}>
      <Button variant="primary" leadingIcon={<Play />} disabled={empty} onClick={() => play()}>{t("musicPlay")}</Button>
      <Button leadingIcon={<Shuffle />} disabled={playlist.tracks.length < 2} onClick={() => play({ shuffle: true })}>{t("musicShuffle")}</Button>
      <Button leadingIcon={<Pencil />} onClick={() => setRenaming(true)}>{t("musicRenamePlaylist")}</Button>
      {!empty ? <Button aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? t("musicDoneEditing") : t("edit")}</Button> : null}
      <Popconfirm message={t("musicDeletePlaylistConfirm", { name: playlist.title })} confirmLabel={t("delete")} confirmVariant="danger" onConfirm={() => void deleteThis()}>
        <IconButton label={t("deletePlaylist")} icon={<Trash2 />} />
      </Popconfirm>
    </MusicDetailHeader>
    {empty ? <EmptyState compact icon={<ListMusic />} title={t("musicPlaylistEmpty")} /> : editing
      ? <div className="music-playlist-edit" role="list">{playlist.tracks.map((track, index) => <div key={track.videoId} role="listitem" className="music-playlist-edit__row">
        <MusicArtwork url={track.thumbnail} size={40} />
        <span className="music-playlist-edit__copy"><span className="music-track__title">{track.title}</span><span className="music-track__detail">{track.artist}</span></span>
        <span className="music-track__time">{durationLabel(track.duration)}</span>
        <IconButton size="sm" variant="ghost" label={t("moveUp")} icon={<ChevronUp />} disabled={index === 0} onClick={() => move(index, index - 1)} />
        <IconButton size="sm" variant="ghost" label={t("moveDown")} icon={<ChevronDown />} disabled={index === playlist.tracks.length - 1} onClick={() => move(index, index + 1)} />
        <IconButton size="sm" variant="ghost" label={t("musicRemoveFromPlaylist")} icon={<X />} onClick={() => remove(track)} />
      </div>)}</div>
      : <MusicTrackList tracks={playlist.tracks} playingId={playingId} onPlay={(track) => play({ startAt: track.videoId })} />}
    <MusicPlaylistNameDialog open={renaming} onOpenChange={setRenaming} title={t("musicRenamePlaylist")} submitLabel={t("save")} initial={playlist.title}
      onSubmit={async (name) => { await musicApi.renamePlaylist(playlist.id, name); page.setData({ ...playlist, title: name }); }} />
  </>;
}

/** Adds a song to a playlist and says how it went. */
export async function addTrackToPlaylist(track: MusicTrack, playlist: MusicUserPlaylist, t: ReturnType<typeof useI18n>["t"]) {
  try {
    const { added } = await musicApi.addToPlaylist(playlist.id, track.videoId);
    emitToast(t(added ? "musicAddedToPlaylist" : "musicAlreadyInPlaylist", { name: playlist.title }), added ? "success" : "default");
  } catch { emitToast(t("musicActionFailed"), "danger"); }
}

/**
 * The profile's playlists to add a song to, and "New playlist". `onDone` runs
 * after any choice, so a surrounding menu can close; `onNewPlaylist` should
 * open a dialog that outlives that menu.
 */
export function MusicAddToPlaylistMenu({ track, onDone, onNewPlaylist }: { track: MusicTrack; onDone: () => void; onNewPlaylist: () => void }) {
  const { t } = useI18n();
  const [playlists, setPlaylists] = useState<MusicUserPlaylist[] | null>(null);
  useEffect(() => {
    let live = true;
    musicApi.myPlaylists().then((list) => { if (live) setPlaylists(list); }, () => { if (live) setPlaylists([]); });
    return () => { live = false; };
  }, []);
  return <Menu>
    {playlists === null ? <MenuLoading label={t("loading")} /> : playlists.map((playlist) =>
      <MenuItem key={playlist.id} icon={<ListMusic />} onClick={() => { onDone(); void addTrackToPlaylist(track, playlist, t); }}>{playlist.title}</MenuItem>)}
    {playlists?.length ? <MenuSeparator /> : null}
    <MenuItem icon={<Plus />} onClick={() => { onDone(); onNewPlaylist(); }}>{t("newPlaylist")}</MenuItem>
  </Menu>;
}

/** A button that opens `MusicAddToPlaylistMenu` for one song. */
export function MusicAddToPlaylistButton({ track }: { track: MusicTrack }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const create = useCreateMusicPlaylist((playlist) => void addTrackToPlaylist(track, playlist, t));
  return <>
    <Popover align="end" placement="auto" surface="menu" open={open} onOpenChange={setOpen}
      trigger={<IconButton variant="ghost" label={t("musicAddToPlaylist")} icon={<ListPlus />} />}>
      {open ? <MusicAddToPlaylistMenu track={track} onDone={() => setOpen(false)} onNewPlaylist={create.open} /> : null}
    </Popover>
    {create.dialog}
  </>;
}
