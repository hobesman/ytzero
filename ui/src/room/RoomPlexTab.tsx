import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Film, Play, RotateCcw } from "lucide-react";
import { useI18n } from "../i18n";
import { Alert, Button, EmptyState, List, ListRow, MenuLoading, ProgressBar, SectionHeader, SelectMenu } from "../components/ui";
import { MusicArtwork, MusicCard, MusicDetailHeader, MusicNote, useMusicData } from "../music/MusicParts";
import { roomPlexApi, type RoomCurrent, type RoomPlexItem, type RoomPlexLibrary, type RoomPlexShow, type RoomPlexSort, type RoomPlexSummary } from "./roomApi";
import { clockDuration, roomPath } from "./roomState";
import type { RoomCommand } from "./useRoomState";
import { RoomSearchBox } from "./RoomSearchBox";
import "./RoomPlexTab.css";

type Translate = ReturnType<typeof useI18n>["t"];

/** "2 h 4 min": a movie's or an episode's length. */
function titleLength(seconds: number, t: Translate): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? t("roomBookHoursMinutes", { hours, minutes: minutes % 60 }) : t("roomBookMinutes", { minutes });
}

/** "S2 E5", or nothing for an episode Plex has no numbers for. */
function episodeCode(item: Pick<RoomPlexItem, "season" | "episode">, t: Translate): string | null {
  return item.season !== null && item.episode !== null ? t("roomPlexEpisodeCode", { season: item.season, episode: item.episode }) : null;
}

/** How far through a title the profile is, 0 to 1; null when not started or already watched. */
function started(item: { duration: number; viewOffset: number; watched: boolean }): number | null {
  return !item.watched && item.viewOffset > 0 && item.duration > 0 ? Math.min(1, item.viewOffset / item.duration) : null;
}

function cardDetail(item: RoomPlexSummary | RoomPlexItem, t: Translate): string {
  const progress = started(item);
  if (progress !== null) return t("roomPlexPercent", { percent: Math.round(progress * 100) });
  if (item.type === "show" && "leafCount" in item) {
    const left = item.leafCount - item.viewedLeafCount;
    return item.watched ? t("roomPlexWatched") : left < item.leafCount ? t("roomPlexUnwatched", { count: left }) : t("roomPlexEpisodes", { count: item.leafCount });
  }
  if (item.type === "episode") {
    const show = "show" in item ? item.show?.title : item.showTitle;
    return [show, "season" in item ? episodeCode(item, t) : null].filter(Boolean).join(" · ");
  }
  return item.watched ? t("roomPlexWatched") : item.year ? String(item.year) : "";
}

function PlexCard({ item, onOpen }: { item: RoomPlexSummary | RoomPlexItem; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const progress = started(item);
  return <div className="room-plex__card">
    <MusicCard art={<MusicArtwork url={roomPlexApi.posterUrl(item.id)} poster />} title={item.title} detail={cardDetail(item, t)} onOpen={() => onOpen(item.id)} />
    {progress !== null ? <ProgressBar value={progress} max={1} label={t("roomPlexProgress")} className="room-plex__card-progress" /> : null}
  </div>;
}

/** Starting a title in the room: the server notes it for the room and has the Echo ask Hoban Plex for it, shown as pending until it plays. */
function useRoomPlex(roomName: string, onCommand: RoomCommand) {
  const { t } = useI18n();
  const [failure, setFailure] = useState<string | null>(null);
  const play = useCallback((itemId: string, startSeconds?: number) => {
    setFailure(null);
    void onCommand(roomName, "play", async () => {
      const answer = await roomPlexApi.play(roomName, { itemId, ...(startSeconds === undefined ? {} : { startSeconds }) });
      if (answer.error) throw new Error(answer.error);
    }).then((error) => { if (error) setFailure(t("roomCommandFailed", { room: roomName, error })); });
  }, [onCommand, roomName, t]);
  return { play, failure };
}

type Play = (itemId: string, startSeconds?: number) => void;

/** The buttons for one movie or episode: play (or resume from its place) and, once started, from the start. */
function PlayButtons({ item, roomName, play, size = "lg" }: { item: RoomPlexItem; roomName: string; play: Play; size?: "md" | "lg" }) {
  const { t } = useI18n();
  const resume = item.resumeAt > 0 ? item.resumeAt : null;
  return <>
    <Button size={size} variant={size === "lg" ? "primary" : "secondary"} leadingIcon={<Play />} onClick={() => play(item.id)}>
      {resume === null ? t("roomPlayIn", { room: roomName }) : t("roomPlexResumeIn", { room: roomName, time: clockDuration(resume * 1000) })}
    </Button>
    {resume !== null ? <Button size={size} variant="ghost" leadingIcon={<RotateCcw />} onClick={() => play(item.id, 0)}>{t("roomPlexStartOver")}</Button> : null}
  </>;
}

function MovieView({ item, roomName, play, playing }: { item: RoomPlexItem; roomName: string; play: Play; playing: boolean }) {
  const { t } = useI18n();
  const detail = [item.show?.title, episodeCode(item, t), item.year, titleLength(item.duration, t), item.watched ? t("roomPlexWatched") : null, playing ? t("roomPlexPlayingHere") : null];
  const at = item.resumeAt;
  const current = item.chapters.reduce((found, chapter) => chapter.start <= at ? chapter.index : found, -1);
  return <>
    <MusicDetailHeader art={roomPlexApi.posterUrl(item.id)} poster title={item.title} detail={detail.filter(Boolean).join(" · ")}>
      <PlayButtons item={item} roomName={roomName} play={play} />
    </MusicDetailHeader>
    {item.overview ? <p className="room-plex__overview">{item.overview}</p> : null}
    {item.chapters.length > 1 ? <section className="music-shelf">
      <SectionHeader title={t("roomPlexChapters")} level={2} description={t("roomPlexChaptersHint", { room: roomName })} />
      <List className="room-plex__rows">
        {item.chapters.map((chapter) => <ListRow key={chapter.index} className={`room-plex__row${at > 0 && chapter.index === current ? " room-plex__row--current" : ""}`}
          title={chapter.title || t("roomPlexChapterNumber", { number: chapter.index + 1 })}
          description={[clockDuration(chapter.start * 1000), titleLength(chapter.end - chapter.start, t)].join(" · ")}
          actions={<Button size="lg" leadingIcon={<Play />} onClick={() => play(item.id, chapter.start)}>{t("roomPlayIn", { room: roomName })}</Button>} />)}
      </List>
    </section> : null}
  </>;
}

function ShowView({ show, roomName, play, playingId }: { show: RoomPlexShow; roomName: string; play: Play; playingId: string | null }) {
  const { t } = useI18n();
  const episodes = show.seasons.flatMap((season) => season.episodes);
  const next = episodes.find((episode) => episode.id === show.nextUpId) ?? null;
  const [season, setSeason] = useState(() => next?.season ?? show.seasons.find((entry) => entry.season > 0)?.season ?? show.seasons[0]?.season ?? 0);
  const shown = show.seasons.find((entry) => entry.season === season) ?? show.seasons[0];
  const seasonLabel = (number: number) => number === 0 ? t("roomPlexSpecials") : t("roomPlexSeason", { number });
  const detail = [show.year, t("roomPlexEpisodes", { count: show.leafCount }), show.watched ? t("roomPlexWatched") : null];
  return <>
    <MusicDetailHeader art={roomPlexApi.posterUrl(show.id)} poster title={show.title} detail={detail.filter(Boolean).join(" · ")}>
      {next ? <Button size="lg" variant="primary" leadingIcon={<Play />} onClick={() => play(next.id)}>
        {t("roomPlexPlayNext", { episode: episodeCode(next, t) ?? next.title, room: roomName })}
      </Button> : null}
    </MusicDetailHeader>
    {show.overview ? <p className="room-plex__overview">{show.overview}</p> : null}
    {shown ? <section className="music-shelf">
      <SectionHeader title={seasonLabel(shown.season)} level={2}
        actions={show.seasons.length > 1 ? <SelectMenu size="lg" floating label={t("roomPlexSeasonPick")} value={String(shown.season)} onChange={(value) => setSeason(Number(value))}
          options={show.seasons.map((entry) => ({ value: String(entry.season), label: seasonLabel(entry.season) }))} /> : undefined} />
      <List className="room-plex__rows">
        {shown.episodes.map((episode) => {
          const progress = started(episode);
          const marks = [episode.id === playingId ? t("roomPlexPlayingHere") : episode.id === next?.id ? t("roomPlexUpNext") : null,
            episode.watched ? t("roomPlexWatched") : progress !== null ? t("roomPlexPercent", { percent: Math.round(progress * 100) }) : null];
          return <ListRow key={episode.id} className={`room-plex__row${episode.id === (playingId ?? next?.id) ? " room-plex__row--current" : ""}`}
            title={[episodeCode(episode, t), episode.title].filter(Boolean).join(" · ")}
            description={[titleLength(episode.duration, t), ...marks].filter(Boolean).join(" · ")}
            actions={<PlayButtons item={episode} roomName={roomName} play={play} size="md" />} />;
        })}
      </List>
    </section> : null}
  </>;
}

function ItemView({ itemId, roomName, play, playingId }: { itemId: string; roomName: string; play: Play; playingId: string | null }) {
  const { t } = useI18n();
  const found = useMusicData(useCallback(() => roomPlexApi.item(itemId), [itemId]));
  if (found.failed) return <MusicNote text={t("roomPlexLoadFailed")} onRetry={found.retry} />;
  if (!found.data) return <MenuLoading label={t("loading")} />;
  return "show" in found.data
    ? <ShowView key={itemId} show={found.data.show} roomName={roomName} play={play} playingId={playingId} />
    : <MovieView item={found.data.item} roomName={roomName} play={play} playing={playingId === itemId} />;
}

const SORTS: readonly RoomPlexSort[] = ["newest", "title"];

/** One library a page at a time ("Show more" adds the next), or what a search finds across every library. */
function LibraryShelf({ libraries, libraryId, query, sort, onChoose, onOpen }: {
  libraries: RoomPlexLibrary[]; libraryId: string; query: string; sort: RoomPlexSort;
  onChoose: (libraryId: string, sort: RoomPlexSort) => void; onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  const first = useMusicData(useCallback(() => roomPlexApi.library(query ? { query } : { libraryId, page: 0, sort }), [query, libraryId, sort]));
  const [more, setMore] = useState<{ pages: number; items: RoomPlexSummary[]; loading: boolean; failed: boolean }>({ pages: 1, items: [], loading: false, failed: false });
  useEffect(() => setMore({ pages: 1, items: [], loading: false, failed: false }), [query, libraryId, sort]);
  const showMore = () => {
    setMore((state) => ({ ...state, loading: true, failed: false }));
    roomPlexApi.library({ libraryId, page: more.pages, sort }).then(
      (page) => setMore((state) => ({ pages: state.pages + 1, items: [...state.items, ...page.items], loading: false, failed: false })),
      () => setMore((state) => ({ ...state, loading: false, failed: true })));
  };
  if (first.failed) return <MusicNote text={t("roomPlexLoadFailed")} onRetry={first.retry} />;
  if (!first.data) return <MenuLoading label={t("loading")} />;
  const seen = new Set<string>();
  const items = [...first.data.items, ...(query ? [] : more.items)].filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)));
  const hasMore = !query && more.pages * first.data.pageSize < first.data.total;
  const pickers = query ? undefined : <div className="room-plex__pickers">
    {libraries.length > 1 ? <SelectMenu size="lg" floating label={t("roomPlexLibrary")} value={libraryId} onChange={(next) => onChoose(next, sort)}
      options={libraries.map((library) => ({ value: library.id, label: library.title }))} /> : null}
    <SelectMenu size="lg" floating label={t("roomPlexSort")} value={sort} onChange={(next) => onChoose(libraryId, next)}
      options={SORTS.map((value) => ({ value, label: t(`roomPlexSort_${value}`) }))} />
  </div>;
  const title = query ? t("roomVideoResults", { query }) : libraries.find((library) => library.id === libraryId)?.title ?? t("roomPlexLibrary");
  return <section className="music-shelf">
    <SectionHeader title={title} level={2} actions={pickers} />
    {!items.length ? <EmptyState compact icon={<Film />} title={query ? t("roomPlexNoResults") : t("roomPlexEmpty")} />
      : <div className="room-plex__grid">{items.map((item) => <PlexCard key={item.id} item={item} onOpen={onOpen} />)}</div>}
    {more.failed ? <MusicNote text={t("roomPlexLoadFailed")} onRetry={showMore} /> : null}
    {hasMore ? <Button size="lg" className="room-plex__more" busy={more.loading} onClick={showMore}>{t("roomBooksMore")}</Button> : null}
  </section>;
}

/**
 * Hoban Plex for the room: what Plex has on deck, the movie and TV libraries
 * with search and posters, a movie's chapters and a show's seasons. A title
 * starts on the room's Echo by the server noting it for the room, then typing
 * "ask hoban plex to play my pick" to the Echo.
 */
export function RoomPlexTab({ roomName, homeRoom, path, onCommand, current }: {
  roomName: string; homeRoom: string; path: string[]; onCommand: RoomCommand;
  /** What the room plays now, when it's from Plex. */
  current: RoomCurrent | null;
}) {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const query = params.get("q")?.trim() ?? "";
  const status = useMusicData(roomPlexApi.status);
  const deck = useMusicData(roomPlexApi.onDeck);
  const { play, failure } = useRoomPlex(roomName, onCommand);
  // Plex moves a title along On Deck once its place is saved: fetched again when the room starts or stops one.
  const playingId = current?.origin === "movies" && current.state !== "finished" ? current.videoId ?? null : null;
  const refreshDeck = deck.retry;
  const deckKey = current?.origin === "movies" ? `${current.videoId ?? ""}:${current.state}` : "";
  useEffect(() => { if (deckKey) refreshDeck(); }, [deckKey, refreshDeck]);

  // The library and its order are in the address, so going back keeps them.
  const libraries = status.data?.libraries ?? [];
  const libraryId = libraries.find((library) => library.id === params.get("library"))?.id ?? libraries[0]?.id ?? "";
  const asked = params.get("sort") as RoomPlexSort | null;
  const sort: RoomPlexSort = asked && SORTS.includes(asked) ? asked : "newest";
  const choose = (library: string, order: RoomPlexSort) => {
    const next = new URLSearchParams();
    if (library !== libraries[0]?.id) next.set("library", library);
    if (order !== "newest") next.set("sort", order);
    navigate(`${roomPath(homeRoom, "plex")}${next.size ? `?${next}` : ""}`, { replace: true });
  };
  const open = (id: string) => navigate(roomPath(homeRoom, `plex/item/${encodeURIComponent(id)}`));
  const search = (text: string) => navigate(`${roomPath(homeRoom, "plex")}${text ? `?q=${encodeURIComponent(text)}` : ""}`);

  if (status.data && !status.data.enabled) return <EmptyState icon={<Film />} title={t("roomPlexOff")} description={t("roomPlexOffHint")} />;
  const alert = failure ? <Alert variant="danger" role="alert" className="room-tab__failure">{failure}</Alert> : null;
  if (path[0] === "item" && path[1]) return <div className="room-plex">{alert}<ItemView itemId={path[1]} roomName={roomName} play={play} playingId={playingId} /></div>;
  return <div className="room-plex">
    <RoomSearchBox value={query} placeholder={t("roomPlexSearchPlaceholder")} onSearch={search} />
    <p className="room-music__hint">{t("roomPlexHint", { room: roomName })}</p>
    {alert}
    {!query && deck.data?.length ? <section className="music-shelf">
      <SectionHeader title={t("roomPlexOnDeck")} level={2} />
      <div className="music-shelf__row">{deck.data.map((item) => <PlexCard key={item.id} item={item} onOpen={open} />)}</div>
    </section> : null}
    {status.data?.enabled && libraryId ? <LibraryShelf libraries={libraries} libraryId={libraryId} query={query} sort={sort} onChoose={choose} onOpen={open} />
      : status.failed ? <MusicNote text={t("roomPlexLoadFailed")} onRetry={status.retry} /> : null}
  </div>;
}
