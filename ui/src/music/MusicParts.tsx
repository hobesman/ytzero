import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { EllipsisVertical, Heart, ListEnd, ListStart, Music, ThumbsDown, X } from "lucide-react";
import { emitToast } from "../events";
import { img } from "../img";
import { useI18n } from "../i18n";
import { Button, EmptyState, IconButton, Menu, MenuItem, Popover, SectionHeader } from "../components/ui";
import { musicPlayer } from "./musicPlayer";
import "./MusicQueueParts.css";
import type { MusicAlbum, MusicArtist, MusicGenre, MusicPlaylist, MusicTrack } from "./musicApi";

export function durationLabel(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0 || !Number.isFinite(seconds)) return "";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Loads a page's data, with a retry when it fails. */
export function useMusicData<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const run = useCallback(() => {
    let live = true;
    setFailed(false);
    load().then((value) => { if (live) setData(value); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [load]);
  useEffect(run, [run]);
  return { data, setData, failed, retry: run };
}

/** Square artwork through the image proxy, or a note when there is none. */
export function MusicArtwork({ url, size, round = false }: { url: string | null | undefined; size?: number; round?: boolean }) {
  const style = size ? { width: size, height: size } : undefined;
  const className = `music-art${round ? " music-art--round" : ""}`;
  if (!url) return <span className={`${className} music-art--empty`} style={style} aria-hidden="true"><Music /></span>;
  return <img className={className} style={style} src={img(url)} alt="" loading="lazy" />;
}

export function MusicNote({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return <EmptyState compact icon={<Music />} title={text} action={onRetry ? <Button size="sm" onClick={onRetry}>{t("musicRetry")}</Button> : undefined} />;
}

/** One song in a list: artwork (or its number on an album), title, artist and length, and its ⋮ menu. */
export const MusicTrackRow = memo(function MusicTrackRow({ track, active, number, hideArtist, onPlay }: {
  track: MusicTrack; active: boolean; number?: number; hideArtist?: boolean; onPlay: (track: MusicTrack) => void;
}) {
  const detail = [hideArtist ? null : track.artist, number == null ? track.album : null].filter(Boolean).join(" · ");
  return <div className="music-track-row"><button type="button" className={`music-track${active ? " music-track--active" : ""}`} onClick={() => onPlay(track)}>
    {number == null ? <MusicArtwork url={track.thumbnail} size={44} /> : <span className="music-track__number">{number}</span>}
    <span className="music-track__copy">
      <span className="music-track__title">{track.title}</span>
      {detail ? <span className="music-track__detail">{detail}</span> : null}
    </span>
    {track.rating === 1 ? <Heart className="music-track__liked" aria-hidden="true" /> : null}
    <span className="music-track__time">{durationLabel(track.duration)}</span>
  </button><MusicTrackMenu track={track} /></div>;
});

export function MusicTrackList({ tracks, playingId, numbered, albumArtist, onPlay }: {
  tracks: MusicTrack[]; playingId: string | null; numbered?: boolean; albumArtist?: string; onPlay: (track: MusicTrack, index: number) => void;
}) {
  return <div className="music-tracks">
    {tracks.map((track, index) => <MusicTrackRow key={track.videoId} track={track} active={track.videoId === playingId}
      number={numbered ? index + 1 : undefined} hideArtist={albumArtist != null && track.artist === albumArtist} onPlay={() => onPlay(track, index)} />)}
  </div>;
}

/** A titled row of cards that scrolls sideways; left out when empty. */
export function MusicShelf({ title, children, count }: { title: string; children: ReactNode; count: number }) {
  if (!count) return null;
  return <section className="music-shelf">
    <SectionHeader title={title} level={2} />
    <div className="music-shelf__row">{children}</div>
  </section>;
}

function Card({ art, title, detail, onOpen }: { art: ReactNode; title: string; detail?: string; onOpen: () => void }) {
  return <button type="button" className="music-card" onClick={onOpen}>
    {art}
    <span className="music-card__title">{title}</span>
    {detail ? <span className="music-card__detail">{detail}</span> : null}
  </button>;
}

export function albumDetail(album: MusicAlbum, t: (key: "musicAlbum" | "musicSingle") => string, withArtist: boolean): string {
  return [withArtist ? album.artist : album.kind === "single" ? t("musicSingle") : t("musicAlbum"), album.year].filter(Boolean).join(" · ");
}

export const MusicAlbumCard = memo(function MusicAlbumCard({ album, withArtist, onOpen }: { album: MusicAlbum; withArtist: boolean; onOpen: (album: MusicAlbum) => void }) {
  const { t } = useI18n();
  return <Card art={<MusicArtwork url={album.thumbnail} />} title={album.title} detail={albumDetail(album, t, withArtist)} onOpen={() => onOpen(album)} />;
});

export const MusicArtistCard = memo(function MusicArtistCard({ artist, onOpen }: { artist: MusicArtist; onOpen: (artist: MusicArtist) => void }) {
  return <Card art={<MusicArtwork url={artist.thumbnail} round />} title={artist.name} onOpen={() => onOpen(artist)} />;
});

export const MusicPlaylistCard = memo(function MusicPlaylistCard({ playlist, onOpen }: { playlist: MusicPlaylist; onOpen: (playlist: MusicPlaylist) => void }) {
  return <Card art={<MusicArtwork url={playlist.thumbnail} />} title={playlist.title} detail={playlist.subtitle} onOpen={() => onOpen(playlist)} />;
});

/** A Moods & genres category, with the colour YouTube Music gives it. */
export const MusicGenreTile = memo(function MusicGenreTile({ genre, onOpen }: { genre: MusicGenre; onOpen: (genre: MusicGenre) => void }) {
  return <button type="button" className="music-genre" style={genre.color ? { borderInlineStartColor: genre.color } : undefined} onClick={() => onOpen(genre)}>
    {genre.title}
  </button>;
});
/** A song's ⋮ menu: Play next, Add to queue, Not this one, and Remove when it is in Up next. */
export function MusicTrackMenu({ track, onRemove }: { track: MusicTrack; onRemove?: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const run = (action: () => void) => () => { setOpen(false); action(); };
  const queue = (placement: "next" | "last") => run(() => {
    // With nothing playing the song simply starts, so there is nothing to announce.
    if (musicPlayer.snapshot().queue) emitToast(placement === "next" ? t("musicQueuedNext") : t("musicQueuedLast"));
    musicPlayer.enqueue(track, placement);
  });
  return <Popover align="end" placement="auto" surface="menu" open={open} onOpenChange={setOpen} rootClassName="music-track-menu"
    trigger={<IconButton size="sm" variant="ghost" label={t("musicMoreOptions")} icon={<EllipsisVertical />} />}>
    <Menu>
      <MenuItem icon={<ListStart />} onClick={queue("next")}>{t("musicPlayNext")}</MenuItem>
      <MenuItem icon={<ListEnd />} onClick={queue("last")}>{t("musicAddToQueue")}</MenuItem>
      {onRemove ? <MenuItem icon={<X />} onClick={run(onRemove)}>{t("musicRemoveFromQueue")}</MenuItem> : null}
      <MenuItem icon={<ThumbsDown />} onClick={run(() => void musicPlayer.dislike(track).catch(() => {}))}>{t("musicNotThis")}</MenuItem>
    </Menu>
  </Popover>;
}

