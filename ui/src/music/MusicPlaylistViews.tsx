import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronDown, ChevronUp, ListMusic, Pencil, Play, Shuffle, Trash2, X } from "lucide-react";
import { emitToast } from "../events";
import { formatSongCount, useI18n } from "../i18n";
import Popconfirm from "../components/Popconfirm";
import { Button, EmptyState, IconButton } from "../components/ui";
import { MusicAddAllToPlaylistButton, MusicPlaylistNameDialog } from "./MusicAddToPlaylist";
import { musicApi, type MusicTrack, type MusicUserPlaylistPage } from "./musicApi";
import { MusicArtwork, MusicDetailHeader, MusicNote, MusicTrackList, durationLabel, useMusicData } from "./MusicParts";
import { musicPlayer, useMusicPlayer } from "./musicPlayer";
import { current } from "./musicQueue";
import "./MusicPlaylistViews.css";

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
      {!empty ? <MusicAddAllToPlaylistButton tracks={playlist.tracks} excludeId={playlist.id} /> : null}
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
