import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Heart, Music, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { img } from "../img";
import { formatSongCount, useI18n } from "../i18n";
import { Button, EmptyState, IconButton, SectionHeader } from "../components/ui";
import type { MusicAlbum, MusicArtist, MusicGenre, MusicPlaylist, MusicTrack, MusicUserPlaylist } from "./musicApi";

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

/** One song in a list: artwork (or its number on an album), title, artist and length. */
export const MusicTrackRow = memo(function MusicTrackRow({ track, active, number, hideArtist, onPlay }: {
  track: MusicTrack; active: boolean; number?: number; hideArtist?: boolean; onPlay: (track: MusicTrack) => void;
}) {
  const detail = [hideArtist ? null : track.artist, number == null ? track.album : null].filter(Boolean).join(" · ");
  return <button type="button" className={`music-track${active ? " music-track--active" : ""}`} onClick={() => onPlay(track)}>
    {number == null ? <MusicArtwork url={track.thumbnail} size={44} /> : <span className="music-track__number">{number}</span>}
    <span className="music-track__copy">
      <span className="music-track__title">{track.title}</span>
      {detail ? <span className="music-track__detail">{detail}</span> : null}
    </span>
    {track.rating === 1 ? <Heart className="music-track__liked" aria-hidden="true" /> : null}
    <span className="music-track__time">{durationLabel(track.duration)}</span>
  </button>;
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

/** The heading of an album, artist, genre or playlist page. */
export function MusicDetailHeader({ art, round, title, detail, children }: { art?: string | null; round?: boolean; title: string; detail?: string; children?: ReactNode }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  return <div className="music-detail">
    <IconButton variant="ghost" className="music-detail__back" label={t("musicBack")} icon={<ArrowLeft />} onClick={() => navigate(-1)} />
    {art !== undefined ? <MusicArtwork url={art} size={160} round={round} /> : null}
    <div className="music-detail__copy">
      <h2 className="music-detail__title">{title}</h2>
      {detail ? <p className="music-detail__meta">{detail}</p> : null}
      {children ? <div className="music-detail__actions">{children}</div> : null}
    </div>
  </div>;
}

/** One of the profile's own playlists in the library. */
export const MusicUserPlaylistCard = memo(function MusicUserPlaylistCard({ playlist, onOpen }: { playlist: MusicUserPlaylist; onOpen: (playlist: MusicUserPlaylist) => void }) {
  const { language } = useI18n();
  return <Card art={<MusicArtwork url={playlist.thumbnail || null} />} title={playlist.title} detail={formatSongCount(playlist.trackCount, language)} onOpen={() => onOpen(playlist)} />;
});

/** The library's "New playlist" tile. */
export function MusicNewPlaylistCard({ onCreate }: { onCreate: () => void }) {
  const { t } = useI18n();
  return <Card art={<span className="music-art music-art--empty" aria-hidden="true"><Plus /></span>} title={t("newPlaylist")} onOpen={onCreate} />;
}
