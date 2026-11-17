import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { Heart, Music, Play, Radio, Search, Shuffle, Sparkles } from "lucide-react";
import { ApiError } from "../apiHttp";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { Button, EmptyState, PageHeader, SectionHeader, Tabs } from "../components/ui";
import SearchResultsHeading from "../components/SearchResultsHeading";
import {
  musicApi, type MusicAlbum, type MusicArtist, type MusicGenre, type MusicPlaylist, type MusicSeed, type MusicTrack, type MusicUserPlaylist,
} from "../music/musicApi";
import { MusicUserPlaylistView, useCreateMusicPlaylist } from "../music/MusicPlaylistViews";
import { musicPlayer, useMusicPlayer } from "../music/musicPlayer";
import { current } from "../music/musicQueue";
import MusicPlayerBar from "../music/MusicPlayerBar";
import {
  MusicAlbumCard, MusicArtistCard, MusicDetailHeader, MusicGenreTile, MusicNewPlaylistCard, MusicNote, MusicPlaylistCard, MusicShelf, MusicTrackList, MusicUserPlaylistCard,
  albumDetail, useMusicData,
} from "../music/MusicParts";
import "./MusicPage.css";

type Tab = "home" | "search" | "library";

/** Opening things and starting music, shared by every music view. */
function useMusicActions() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const play = useCallback((seed: MusicSeed, options?: { shuffle?: boolean; from?: string }) => {
    setFailed(false);
    void musicPlayer.start(seed, options).then(() => { if (musicPlayer.snapshot().error) setFailed(true); });
  }, []);
  return {
    t, play, failed,
    playingId: current(useMusicPlayer().queue)?.videoId ?? null,
    openAlbum: useCallback((album: MusicAlbum) => navigate(`/music/album/${encodeURIComponent(album.browseId)}`), [navigate]),
    openArtist: useCallback((artist: MusicArtist) => navigate(`/music/artist/${encodeURIComponent(artist.channelId)}`), [navigate]),
    openGenre: useCallback((genre: MusicGenre) => navigate(`/music/genre/${encodeURIComponent(genre.id)}`), [navigate]),
    openPlaylist: useCallback((playlist: MusicPlaylist) => navigate(`/music/playlist/${encodeURIComponent(playlist.playlistId)}`), [navigate]),
    playTrack: useCallback((track: MusicTrack) => play({ kind: "track", videoId: track.videoId }), [play]),
  };
}

function StationCard({ icon, title, hint, onPlay }: { icon: ReactNode; title: string; hint: string; onPlay: () => void }) {
  return <button type="button" className="music-station" onClick={onPlay}>
    <span className="music-station__icon">{icon}</span>
    <span className="music-station__copy"><span className="music-station__title">{title}</span><span className="music-station__hint">{hint}</span></span>
    <Play className="music-station__play" aria-hidden="true" />
  </button>;
}

function HomeView() {
  const actions = useMusicActions();
  const { t } = actions;
  const library = useMusicData(musicApi.library);
  const genres = useMusicData(musicApi.genres);
  if (library.failed && library.data === null) return <MusicNote text={t("musicLoadFailed")} onRetry={library.retry} />;
  const moods = genres.data?.filter((genre) => genre.group === "mood") ?? [];
  const kinds = genres.data?.filter((genre) => genre.group === "genre") ?? [];
  const recent = library.data?.recent ?? [];
  return <>
    <div className="music-stations">
      <StationCard icon={<Sparkles />} title={t("musicYourMix")} hint={t("musicYourMixHint")} onPlay={() => actions.play({ kind: "mix" })} />
      <StationCard icon={<Heart />} title={t("musicLikedSongs")} hint={t("musicLikedSongsHint")} onPlay={() => actions.play({ kind: "liked" })} />
    </div>
    {actions.failed ? <p className="music-error" role="alert">{t("musicStartFailed")}</p> : null}
    {[{ title: t("musicMoods"), list: moods }, { title: t("musicGenres"), list: kinds }].map(({ title, list }) => list.length ? <section key={title} className="music-shelf">
      <SectionHeader title={title} level={2} />
      <div className="music-genres">{list.map((genre) => <MusicGenreTile key={genre.id} genre={genre} onOpen={actions.openGenre} />)}</div>
    </section> : null)}
    {genres.failed ? <MusicNote text={t("musicPageFailed")} onRetry={genres.retry} /> : null}
    <section className="music-shelf">
      <SectionHeader title={t("musicRecent")} level={2} />
      {library.data && !recent.length ? <MusicNote text={t("musicRecentEmpty")} /> : null}
      <MusicTrackList tracks={recent.slice(0, 20)} playingId={actions.playingId} onPlay={actions.playTrack} />
    </section>
  </>;
}

function SearchView() {
  const actions = useMusicActions();
  const { t } = actions;
  const location = useLocation();
  const asked = new URLSearchParams(location.search).get("q")?.trim() ?? "";
  const [results, setResults] = useState<Awaited<ReturnType<typeof musicApi.search>> | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  useEffect(() => {
    if (!asked) { setResults(null); return; }
    let live = true;
    setState("loading");
    musicApi.search(asked).then((found) => { if (live) { setResults(found); setState("idle"); } }, () => { if (live) setState("failed"); });
    return () => { live = false; };
  }, [asked]);
  const empty = results && !results.tracks.length && !results.albums.length && !results.artists.length;
  // The top-bar search, set to music on these pages, is the one place to type a search.
  if (!asked) return <EmptyState icon={<Search />} title={t("musicSearchPlaceholder")} />;
  return <>
    <SearchResultsHeading query={asked} mode="music" />
    {state === "failed" ? <MusicNote text={t("musicSearchFailed")} /> : null}
    {empty ? <MusicNote text={t("musicNoResults")} /> : null}
    {results && state !== "failed" ? <>
      {results.tracks.length ? <section className="music-shelf">
        <SectionHeader title={t("musicSongs")} level={2} />
        <MusicTrackList tracks={results.tracks} playingId={actions.playingId} onPlay={actions.playTrack} />
      </section> : null}
      <MusicShelf title={t("musicArtists")} count={results.artists.length}>
        {results.artists.map((artist) => <MusicArtistCard key={artist.channelId} artist={artist} onOpen={actions.openArtist} />)}
      </MusicShelf>
      <MusicShelf title={t("musicAlbums")} count={results.albums.length}>
        {results.albums.map((album) => <MusicAlbumCard key={album.browseId} album={album} withArtist onOpen={actions.openAlbum} />)}
      </MusicShelf>
    </> : null}
  </>;
}

function LibraryView() {
  const actions = useMusicActions();
  const { t } = actions;
  const navigate = useNavigate();
  const library = useMusicData(musicApi.library);
  const openMine = useCallback((playlist: MusicUserPlaylist) => navigate(`/music/mine/${encodeURIComponent(playlist.id)}`), [navigate]);
  const create = useCreateMusicPlaylist(openMine);
  if (library.failed && !library.data) return <MusicNote text={t("musicLoadFailed")} onRetry={library.retry} />;
  if (!library.data) return null;
  const { liked, albums, playlists, savedPlaylists } = library.data;
  return <>
    <section className="music-shelf">
      <SectionHeader title={t("musicYourPlaylists")} level={2} />
      <div className="music-shelf__row">
        <MusicNewPlaylistCard onCreate={create.open} />
        {playlists.map((playlist) => <MusicUserPlaylistCard key={playlist.id} playlist={playlist} onOpen={openMine} />)}
      </div>
    </section>
    {create.dialog}
    <MusicShelf title={t("musicSavedPlaylists")} count={savedPlaylists.length}>
      {savedPlaylists.map((playlist) => <MusicPlaylistCard key={playlist.playlistId} playlist={playlist} onOpen={actions.openPlaylist} />)}
    </MusicShelf>
    <MusicShelf title={t("musicSavedAlbums")} count={albums.length}>
      {albums.map((album) => <MusicAlbumCard key={album.browseId} album={album} withArtist onOpen={actions.openAlbum} />)}
    </MusicShelf>
    {liked.length ? <section className="music-shelf">
      <SectionHeader title={t("musicLikedSongs")} level={2}
        actions={<Button size="sm" leadingIcon={<Play />} onClick={() => actions.play({ kind: "liked" })}>{t("musicPlayStation")}</Button>} />
      <MusicTrackList tracks={liked} playingId={actions.playingId} onPlay={actions.playTrack} />
    </section> : null}
    {!liked.length && !albums.length && !savedPlaylists.length ? <MusicNote text={t("musicLibraryEmpty")} /> : null}
  </>;
}

function useParamData<T>(load: (id: string) => Promise<T>) {
  const { id = "" } = useParams();
  return useMusicData(useCallback(() => load(id), [load, id]));
}

function AlbumView() {
  const actions = useMusicActions();
  const { t } = actions;
  const page = useParamData(musicApi.album);
  const album = page.data;
  if (page.failed && !album) return <MusicNote text={t("musicPageFailed")} onRetry={page.retry} />;
  if (!album) return null;
  const toggleSaved = () => {
    const saved = !album.saved;
    page.setData({ ...album, saved });
    void musicApi.setAlbumSaved(album.browseId, saved).catch(() => page.setData({ ...album }));
  };
  const seed = (startAt?: string): MusicSeed => ({ kind: "album", browseId: album.browseId, startAt });
  return <>
    <MusicDetailHeader art={album.thumbnail} title={album.title} detail={[album.artist, albumDetail(album, t, false)].filter(Boolean).join(" · ")}>
      <Button variant="primary" leadingIcon={<Play />} onClick={() => actions.play(seed(), { from: album.title })}>{t("musicPlay")}</Button>
      <Button leadingIcon={<Shuffle />} onClick={() => actions.play(seed(), { shuffle: true, from: album.title })}>{t("musicShuffle")}</Button>
      <Button leadingIcon={<Heart fill={album.saved ? "currentColor" : "none"} />} onClick={toggleSaved}>{album.saved ? t("musicSaved") : t("musicSave")}</Button>
    </MusicDetailHeader>
    {actions.failed ? <p className="music-error" role="alert">{t("musicStartFailed")}</p> : null}
    <MusicTrackList tracks={album.tracks} numbered albumArtist={album.artist} playingId={actions.playingId}
      onPlay={(track) => actions.play(seed(track.videoId), { from: album.title })} />
  </>;
}

function ArtistView() {
  const actions = useMusicActions();
  const { t } = actions;
  const page = useParamData(musicApi.artist);
  const artist = page.data;
  if (page.failed && !artist) return <MusicNote text={t("musicPageFailed")} onRetry={page.retry} />;
  if (!artist) return null;
  return <>
    <MusicDetailHeader art={artist.thumbnail} round title={artist.name}>
      <Button variant="primary" leadingIcon={<Play />} onClick={() => actions.play({ kind: "artist", artistId: artist.channelId })}>{t("musicPlayArtist")}</Button>
      <Button leadingIcon={<Radio />} onClick={() => actions.play({ kind: "artist", artistId: artist.channelId, radio: true })}>{t("musicArtistRadio")}</Button>
    </MusicDetailHeader>
    {actions.failed ? <p className="music-error" role="alert">{t("musicStartFailed")}</p> : null}
    {artist.topSongs.length ? <section className="music-shelf">
      <SectionHeader title={t("musicTopSongs")} level={2} />
      <MusicTrackList tracks={artist.topSongs} playingId={actions.playingId} onPlay={actions.playTrack} />
    </section> : null}
    <MusicShelf title={t("musicAlbums")} count={artist.albums.length}>
      {artist.albums.map((album) => <MusicAlbumCard key={album.browseId} album={album} withArtist={false} onOpen={actions.openAlbum} />)}
    </MusicShelf>
    <MusicShelf title={t("musicSingles")} count={artist.singles.length}>
      {artist.singles.map((album) => <MusicAlbumCard key={album.browseId} album={album} withArtist={false} onOpen={actions.openAlbum} />)}
    </MusicShelf>
  </>;
}

function GenreView() {
  const actions = useMusicActions();
  const page = useParamData(musicApi.genre);
  const genre = page.data;
  if (page.failed && !genre) return <MusicNote text={actions.t("musicPageFailed")} onRetry={page.retry} />;
  if (!genre) return null;
  return <>
    <MusicDetailHeader title={genre.title} />
    {genre.shelves.map((shelf) => <MusicShelf key={shelf.title} title={shelf.title} count={shelf.playlists.length}>
      {shelf.playlists.map((playlist) => <MusicPlaylistCard key={playlist.playlistId} playlist={playlist} onOpen={actions.openPlaylist} />)}
    </MusicShelf>)}
  </>;
}

function PlaylistView() {
  const actions = useMusicActions();
  const { t } = actions;
  const page = useParamData(musicApi.playlist);
  const playlist = page.data;
  if (page.failed && !playlist) return <MusicNote text={t("musicPageFailed")} onRetry={page.retry} />;
  if (!playlist) return null;
  const seed: MusicSeed = { kind: "playlist", playlistId: playlist.playlistId };
  const toggleSaved = () => {
    const saved = !playlist.saved;
    page.setData({ ...playlist, saved });
    void musicApi.setPlaylistSaved(playlist.playlistId, saved).catch(() => page.setData({ ...playlist }));
  };
  return <>
    <MusicDetailHeader art={playlist.thumbnail} title={playlist.title} detail={playlist.subtitle}>
      <Button variant="primary" leadingIcon={<Shuffle />} onClick={() => actions.play(seed, { from: playlist.title })}>{t("musicShuffle")}</Button>
      <Button leadingIcon={<Heart fill={playlist.saved ? "currentColor" : "none"} />} onClick={toggleSaved}>{playlist.saved ? t("musicSaved") : t("musicSave")}</Button>
    </MusicDetailHeader>
    {actions.failed ? <p className="music-error" role="alert">{t("musicStartFailed")}</p> : null}
    <MusicTrackList tracks={playlist.tracks} playingId={actions.playingId} onPlay={actions.playTrack} />
  </>;
}

/** Probes the server once: a child profile, or a server without music, gets a note instead of the pages. */
function useMusicAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    musicApi.library().then(() => { if (live) setAvailable(true); },
      (error) => { if (live) setAvailable(!(error instanceof ApiError && (error.status === 403 || error.status === 404))); });
    return () => { live = false; };
  }, []);
  return available;
}

export default function MusicPage() {
  const { t } = useI18n();
  useDocumentTitle(t("navMusic"));
  const navigate = useNavigate();
  const location = useLocation();
  const available = useMusicAvailable();
  const section = location.pathname.split("/")[2] ?? "";
  const tab: Tab = section === "search" ? "search" : section === "library" || section === "mine" ? "library" : "home";
  // Search has no tab: the top-bar search runs it, and on search results neither tab is selected.
  const tabs = [{ value: "home" as const, label: t("musicHome") }, { value: "library" as const, label: t("musicLibrary") }];
  return <div className="music-page">
    <PageHeader title={t("navMusic")} icon={<Music />}
      actions={<Tabs label={t("navMusic")} value={tab} options={tabs} onChange={(next) => navigate(next === "home" ? "/music" : `/music/${next}`)} />} />
    <div className="music-page__body">
      {available === false ? <MusicNote text={t("musicNotAvailable")} /> : available ? <Routes>
        <Route index element={<HomeView />} />
        <Route path="search" element={<SearchView />} />
        <Route path="library" element={<LibraryView />} />
        <Route path="album/:id" element={<AlbumView />} />
        <Route path="artist/:id" element={<ArtistView />} />
        <Route path="genre/:id" element={<GenreView />} />
        <Route path="playlist/:id" element={<PlaylistView />} />
        <Route path="mine/:id" element={<MusicUserPlaylistView />} />
      </Routes> : null}
    </div>
    <MusicPlayerBar />
  </div>;
}
