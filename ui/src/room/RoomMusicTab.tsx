import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Heart, ListMusic, Play, Radio, RotateCcw, Search, Sparkles } from "lucide-react";
import { formatSongCount, useI18n } from "../i18n";
import { parseAppTimestamp } from "../dateTime";
import { Button, Input, SectionHeader } from "../components/ui";
import {
  musicApi, type MusicAlbum, type MusicAlbumPage, type MusicArtist, type MusicArtistPage, type MusicGenre, type MusicGenrePage, type MusicPlaylist,
  type MusicPlaylistPage, type MusicTrack, type MusicUserPlaylist, type MusicUserPlaylistPage,
} from "../music/musicApi";
import {
  MusicAlbumCard, MusicArtistCard, MusicDetailHeader, MusicGenreTile, MusicNote, MusicPlaylistCard, MusicShelf, MusicTrackList, MusicUserPlaylistCard,
  albumDetail, useMusicData,
} from "../music/MusicParts";
import { roomApi, type RoomQueue, type RoomSeed } from "./roomApi";
import { deviceTimeZone, roomPath } from "./roomState";
import type { RoomCommand } from "./useRoomState";
import "../pages/MusicPage.css";

type QueueRequest = { title: string } & ({ videoIds: string[] } | { seed: RoomSeed });

/** Starting music in the room: saves the room's queue with play: true, shown as pending until the Echo takes it. */
function useRoomMusic(roomName: string, homeRoom: string, onCommand: RoomCommand, onQueued: () => void) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [failure, setFailure] = useState<string | null>(null);
  const play = useCallback((queue: QueueRequest) => {
    setFailure(null);
    void onCommand(roomName, "play", async () => {
      const saved = await roomApi.playQueue(roomName, queue);
      onQueued();
      if (saved.error) throw new Error(saved.error);
    }).then((error) => { if (error) setFailure(t("roomCommandFailed", { room: roomName, error })); });
  }, [onCommand, onQueued, roomName, t]);
  const open = (path: string) => navigate(roomPath(homeRoom, `music/${path}`));
  return {
    t, play, failure,
    playTracks: (tracks: MusicTrack[], from: number, title: string) => play({ title, videoIds: tracks.slice(from).map((track) => track.videoId) }),
    openAlbum: (album: MusicAlbum) => open(`album/${encodeURIComponent(album.browseId)}`),
    openArtist: (artist: MusicArtist) => open(`artist/${encodeURIComponent(artist.channelId)}`),
    openGenre: (genre: MusicGenre) => open(`genre/${encodeURIComponent(genre.id)}`),
    openPlaylist: (playlist: MusicPlaylist) => open(`playlist/${encodeURIComponent(playlist.playlistId)}`),
    openMine: (playlist: MusicUserPlaylist) => open(`mine/${encodeURIComponent(playlist.id)}`),
    search: (query: string) => open(`search?q=${encodeURIComponent(query)}`),
  };
}
type RoomMusic = ReturnType<typeof useRoomMusic>;

function PlayInRoom({ roomName, onClick, icon = <Play />, label }: { roomName: string; onClick: () => void; icon?: ReactNode; label?: string }) {
  const { t } = useI18n();
  return <Button size="lg" variant="primary" leadingIcon={icon} onClick={onClick}>{label ?? t("roomPlayIn", { room: roomName })}</Button>;
}

function StationButton({ icon, title, hint, onPlay }: { icon: ReactNode; title: string; hint: string; onPlay: () => void }) {
  return <button type="button" className="music-station room-music__station" onClick={onPlay}>
    <span className="music-station__icon">{icon}</span>
    <span className="music-station__copy"><span className="music-station__title">{title}</span><span className="music-station__hint">{hint}</span></span>
    <Play className="music-station__play" aria-hidden="true" />
  </button>;
}

/** The room's saved queue: what "play my queue" plays there. */
function RoomQueueCard({ roomName, queue, onReplay }: { roomName: string; queue: RoomQueue | null | undefined; onReplay: () => void }) {
  const { t, locale, language } = useI18n();
  if (queue === undefined) return null;
  if (!queue) return <p className="room-music__queue room-music__queue--empty">{t("roomQueueEmpty", { room: roomName })}</p>;
  const saved = new Intl.DateTimeFormat(locale, { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: deviceTimeZone() })
    .format(parseAppTimestamp(queue.savedAt));
  const what = queue.seed ? t(`roomQueueSeed_${queue.seed.kind === "artist" && queue.seed.radio ? "radio" : queue.seed.kind}`) : formatSongCount(queue.videoIds.length, language);
  return <div className="room-music__queue">
    <ListMusic aria-hidden="true" />
    <div className="room-music__queue-copy">
      <span className="room-music__queue-label">{t("roomQueueTitle", { room: roomName })}</span>
      <span className="room-music__queue-title">{queue.title || what}</span>
      <span className="room-music__queue-detail">{[queue.title ? what : null, t("roomQueueSaved", { time: saved })].filter(Boolean).join(" · ")}</span>
    </div>
    <Button size="lg" leadingIcon={<RotateCcw />} onClick={onReplay}>{t("roomPlayAgain")}</Button>
  </div>;
}

function HomeView({ music, roomName, queue, onReplay }: { music: RoomMusic; roomName: string; queue: RoomQueue | null | undefined; onReplay: () => void }) {
  const { t } = music;
  const library = useMusicData(musicApi.library);
  const genres = useMusicData(musicApi.genres);
  if (library.failed && library.data === null) return <MusicNote text={t("musicLoadFailed")} onRetry={library.retry} />;
  const data = library.data;
  return <>
    <RoomQueueCard roomName={roomName} queue={queue} onReplay={onReplay} />
    <div className="music-stations">
      <StationButton icon={<Sparkles />} title={t("musicYourMix")} hint={t("roomPlayIn", { room: roomName })} onPlay={() => music.play({ title: t("musicYourMix"), seed: { kind: "mix" } })} />
      <StationButton icon={<Heart />} title={t("musicLikedSongs")} hint={t("roomPlayIn", { room: roomName })} onPlay={() => music.play({ title: t("musicLikedSongs"), seed: { kind: "liked" } })} />
    </div>
    {data ? <>
      <MusicShelf title={t("musicYourPlaylists")} count={data.playlists.length}>
        {data.playlists.map((playlist) => <MusicUserPlaylistCard key={playlist.id} playlist={playlist} onOpen={music.openMine} />)}
      </MusicShelf>
      <MusicShelf title={t("musicSavedPlaylists")} count={data.savedPlaylists.length}>
        {data.savedPlaylists.map((playlist) => <MusicPlaylistCard key={playlist.playlistId} playlist={playlist} onOpen={music.openPlaylist} />)}
      </MusicShelf>
      <MusicShelf title={t("musicSavedAlbums")} count={data.albums.length}>
        {data.albums.map((album) => <MusicAlbumCard key={album.browseId} album={album} withArtist onOpen={music.openAlbum} />)}
      </MusicShelf>
      {data.recent.length ? <section className="music-shelf">
        <SectionHeader title={t("musicRecent")} level={2} description={t("roomTapToPlay", { room: roomName })} />
        <MusicTrackList menu={false} tracks={data.recent.slice(0, 12)} playingId={null}
          onPlay={(track) => music.play({ title: track.title, videoIds: [track.videoId] })} />
      </section> : null}
    </> : null}
    {genres.data?.length ? <section className="music-shelf">
      <SectionHeader title={t("musicGenres")} level={2} />
      <div className="music-genres">{genres.data.map((genre) => <MusicGenreTile key={genre.id} genre={genre} onOpen={music.openGenre} />)}</div>
    </section> : null}
  </>;
}

function SearchView({ music, query, roomName }: { music: RoomMusic; query: string; roomName: string }) {
  const { t } = music;
  const results = useMusicData(useCallback(() => musicApi.search(query), [query]));
  if (results.failed) return <MusicNote text={t("musicSearchFailed")} onRetry={results.retry} />;
  const found = results.data;
  if (!found) return null;
  if (!found.tracks.length && !found.albums.length && !found.artists.length) return <MusicNote text={t("musicNoResults")} />;
  return <>
    {found.tracks.length ? <section className="music-shelf">
      <SectionHeader title={t("musicSongs")} level={2} description={t("roomTapToPlay", { room: roomName })} />
      <MusicTrackList menu={false} tracks={found.tracks} playingId={null} onPlay={(track) => music.play({ title: track.title, videoIds: [track.videoId] })} />
    </section> : null}
    <MusicShelf title={t("musicArtists")} count={found.artists.length}>
      {found.artists.map((artist) => <MusicArtistCard key={artist.channelId} artist={artist} onOpen={music.openArtist} />)}
    </MusicShelf>
    <MusicShelf title={t("musicAlbums")} count={found.albums.length}>
      {found.albums.map((album) => <MusicAlbumCard key={album.browseId} album={album} withArtist onOpen={music.openAlbum} />)}
    </MusicShelf>
  </>;
}

type MusicDetail =
  | { kind: "album"; page: MusicAlbumPage }
  | { kind: "artist"; page: MusicArtistPage }
  | { kind: "genre"; page: MusicGenrePage }
  | { kind: "mine"; page: MusicUserPlaylistPage }
  | { kind: "playlist"; page: MusicPlaylistPage };

function DetailView({ music, kind, id, roomName }: { music: RoomMusic; kind: string; id: string; roomName: string }) {
  const { t } = music;
  const load = useCallback((): Promise<MusicDetail> => {
    if (kind === "album") return musicApi.album(id).then((page) => ({ kind: "album", page }));
    if (kind === "artist") return musicApi.artist(id).then((page) => ({ kind: "artist", page }));
    if (kind === "genre") return musicApi.genre(id).then((page) => ({ kind: "genre", page }));
    if (kind === "mine") return musicApi.myPlaylist(id).then((page) => ({ kind: "mine", page }));
    return musicApi.playlist(id).then((page) => ({ kind: "playlist", page }));
  }, [id, kind]);
  const data = useMusicData(load);
  if (data.failed && !data.data) return <MusicNote text={t("musicPageFailed")} onRetry={data.retry} />;
  const loaded = data.data;
  if (!loaded) return null;
  const tap = (tracks: MusicTrack[], title: string) => <>
    <p className="room-music__hint">{t("roomTapToPlay", { room: roomName })}</p>
    <MusicTrackList menu={false} tracks={tracks} playingId={null} numbered={loaded.kind === "album"}
      albumArtist={loaded.kind === "album" ? loaded.page.artist : undefined} onPlay={(_track, index) => music.playTracks(tracks, index, title)} />
  </>;
  switch (loaded.kind) {
    case "album": {
      const album = loaded.page;
      return <>
        <MusicDetailHeader art={album.thumbnail} title={album.title} detail={[album.artist, albumDetail(album, t, false)].filter(Boolean).join(" · ")}>
          <PlayInRoom roomName={roomName} onClick={() => music.play({ title: album.title, seed: { kind: "album", browseId: album.browseId } })} />
        </MusicDetailHeader>
        {tap(album.tracks, album.title)}
      </>;
    }
    case "artist": {
      const artist = loaded.page;
      return <>
        <MusicDetailHeader art={artist.thumbnail} round title={artist.name}>
          <PlayInRoom roomName={roomName} onClick={() => music.play({ title: artist.name, seed: { kind: "artist", artistId: artist.channelId } })} />
          <PlayInRoom roomName={roomName} icon={<Radio />} label={t("roomRadioIn", { room: roomName })}
            onClick={() => music.play({ title: t("musicArtistRadio"), seed: { kind: "artist", artistId: artist.channelId, radio: true } })} />
        </MusicDetailHeader>
        {artist.topSongs.length ? tap(artist.topSongs, artist.name) : null}
        <MusicShelf title={t("musicAlbums")} count={artist.albums.length}>
          {artist.albums.map((album) => <MusicAlbumCard key={album.browseId} album={album} withArtist={false} onOpen={music.openAlbum} />)}
        </MusicShelf>
      </>;
    }
    case "genre":
      return <>
        <MusicDetailHeader title={loaded.page.title} />
        {loaded.page.shelves.map((shelf) => <MusicShelf key={shelf.title} title={shelf.title} count={shelf.playlists.length}>
          {shelf.playlists.map((playlist) => <MusicPlaylistCard key={playlist.playlistId} playlist={playlist} onOpen={music.openPlaylist} />)}
        </MusicShelf>)}
      </>;
    case "mine": {
      const playlist = loaded.page;
      return <>
        <MusicDetailHeader art={playlist.thumbnail || null} title={playlist.title}>
          {playlist.tracks.length ? <PlayInRoom roomName={roomName} onClick={() => music.playTracks(playlist.tracks, 0, playlist.title)} /> : null}
        </MusicDetailHeader>
        {tap(playlist.tracks, playlist.title)}
      </>;
    }
    case "playlist": {
      const playlist = loaded.page;
      return <>
        <MusicDetailHeader art={playlist.thumbnail} title={playlist.title} detail={playlist.subtitle}>
          <PlayInRoom roomName={roomName} onClick={() => music.play({ title: playlist.title, seed: { kind: "playlist", playlistId: playlist.playlistId } })} />
        </MusicDetailHeader>
        {tap(playlist.tracks, playlist.title)}
      </>;
    }
  }
}

/**
 * Music mode's pages, playing in the room's Echo instead of this browser:
 * every song, album, playlist, artist and station starts there through the
 * room's queue. `path` is what follows `/room/<room>/music/`.
 */
export function RoomMusicTab({ roomName, homeRoom, path, onCommand }: { roomName: string; homeRoom: string; path: string[]; onCommand: RoomCommand }) {
  const location = useLocation();
  const [queue, setQueue] = useState<RoomQueue | null | undefined>(undefined);
  const loadQueue = useCallback(() => { roomApi.queue(roomName).then(setQueue, () => setQueue(undefined)); }, [roomName]);
  useEffect(loadQueue, [loadQueue]);
  const music = useRoomMusic(roomName, homeRoom, onCommand, loadQueue);
  const query = path[0] === "search" ? new URLSearchParams(location.search).get("q")?.trim() ?? "" : "";
  const [draft, setDraft] = useState(query);
  useEffect(() => setDraft(query), [query]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim()) music.search(draft.trim());
  };
  const replay = () => void onCommand(roomName, "play", () => roomApi.replayQueue(roomName));
  const [kind, id] = path;
  return <div className="room-music">
    <form className="room-music__search" role="search" onSubmit={submit}>
      <Input size="lg" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={music.t("musicSearchPlaceholder")} aria-label={music.t("musicSearchPlaceholder")} enterKeyHint="search" />
      <Button size="lg" type="submit" leadingIcon={<Search />}>{music.t("search")}</Button>
    </form>
    {music.failure ? <p className="music-error" role="alert">{music.failure}</p> : null}
    {kind === "search" && query ? <SearchView music={music} query={query} roomName={roomName} />
      : kind && id && ["album", "artist", "genre", "playlist", "mine"].includes(kind) ? <DetailView music={music} kind={kind} id={decodeURIComponent(id)} roomName={roomName} />
      : <HomeView music={music} roomName={roomName} queue={queue} onReplay={replay} />}
  </div>;
}
