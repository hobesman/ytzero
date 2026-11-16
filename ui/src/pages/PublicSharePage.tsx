import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, ListVideo, LoaderCircle, Play, TimerOff } from "lucide-react";
import { Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import type { PlaylistVideo, PublicShareData, VideoCreator } from "../api";
import LocalPlayer, { type LocalPlayerHandle, type LocalPlayerShortcut } from "../components/LocalPlayer";
import { parseVideoDurationSeconds } from "../components/VideoCard";
import VideoCreators from "../components/VideoCreators";
import { Button, EmptyState, IconButton } from "../components/ui";
import WatchChapterPanel from "../components/watch/WatchChapterPanel";
import WatchPlaylistPanel from "../components/watch/WatchPlaylistPanel";
import PublicYouTubePlayer from "../components/watch/PublicYouTubePlayer";
import WatchVideoDescription from "../components/watch/WatchVideoDescription";
import { useI18n } from "../i18n";
import { resolveShortcutBindings, shortcutActionMatches } from "../keyboardShortcuts";
import { parseShareTimestamp } from "../shareTimestamp";
import WatchPlayerFeedback from "./WatchPlayerFeedback";
import "./WatchPage.css";
import "./PublicSharePage.css";

const KEYBOARD_SEEK_SECONDS = 5;

type PublicShareLoadError = "unavailable" | "rate_limited" | "expired" | "plays_exhausted";

function loadError(reason: unknown): PublicShareLoadError {
  const message = reason instanceof Error ? reason.message : "";
  return message === "rate_limited" || message === "expired" || message === "plays_exhausted" ? message : "unavailable";
}

async function loadPublicShare(token: string, videoId?: string, page = 0): Promise<PublicShareData> {
  const query = new URLSearchParams({ page: String(page) });
  if (videoId) query.set("video", videoId);
  const response = await fetch(`/share/${encodeURIComponent(token)}/data?${query}`, {
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (response.status === 410) {
    const body = await response.json().catch(() => null) as { reason?: string } | null;
    throw new Error(body?.reason === "plays_exhausted" ? "plays_exhausted" : "expired");
  }
  if (!response.ok) throw new Error(response.status === 429 ? "rate_limited" : "unavailable");
  return response.json() as Promise<PublicShareData>;
}

function PublicShareView() {
  const { token = "", videoId } = useParams<{ token: string; videoId?: string }>();
  const { t } = useI18n();
  const navigate = useNavigate();
  const startSeconds = parseShareTimestamp(useLocation().search);
  const playerRef = useRef<LocalPlayerHandle>(null);
  const playerShellRef = useRef<HTMLDivElement>(null);
  const activePlaylistItemRef = useRef<HTMLAnchorElement>(null);
  const playlistItemsRef = useRef<HTMLDivElement>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const [data, setData] = useState<PublicShareData | null>(null);
  const [items, setItems] = useState<PublicShareData["items"]>([]);
  const [page, setPage] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<PublicShareLoadError | null>(null);
  // A server stream that fails falls back to the YouTube embed for that video.
  const [streamFailedFor, setStreamFailedFor] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: LocalPlayerShortcut; id: number; seconds?: number } | null>(null);
  const [cinemaMode, setCinemaMode] = useState(true);
  const [cinemaVisible, setCinemaVisible] = useState(true);
  const [topbarSolid, setTopbarSolid] = useState(() => window.scrollY > 8);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setItems([]);
    setPage(0);
    setError(null);
    void loadPublicShare(token, videoId).then((result) => {
      if (cancelled) return;
      setData(result);
      setItems(result.items);
      document.title = `${result.video?.title ?? result.resource.title} · ${result.brand.name}`;
    }).catch((reason) => {
      if (!cancelled) setError(loadError(reason));
    });
    return () => { cancelled = true; };
  }, [token, videoId]);

  useEffect(() => () => {
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
  }, []);

  const showShortcutFeedback = useCallback((kind: LocalPlayerShortcut, seconds?: number) => {
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    setFeedback({ kind, id: Date.now(), seconds });
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), 1_560);
  }, []);

  const loadMore = useCallback(async () => {
    if (!data?.has_more || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await loadPublicShare(token, data.video?.video_id, page + 1);
      setItems((current) => [...current, ...result.items.filter((item) => !current.some((known) => known.video_id === item.video_id))]);
      setPage((current) => current + 1);
      setData((current) => current ? { ...current, has_more: result.has_more } : current);
    } catch (reason) {
      setError(loadError(reason));
    } finally {
      setLoadingMore(false);
    }
  }, [data, loadingMore, page, token]);

  const currentIndex = useMemo(() => items.findIndex((item) => item.video_id === data?.video?.video_id), [data?.video?.video_id, items]);
  const openVideo = useCallback((id: string) => navigate(`/share/${token}/video/${id}`), [navigate, token]);
  const previous = currentIndex > 0 ? items[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < items.length - 1 ? items[currentIndex + 1] : null;
  const creators = useMemo<VideoCreator[]>(() => data?.creators.map((creator) => ({
    avatar: creator.avatar,
    channelId: creator.channel_id,
    handle: creator.handle,
    isOwner: creator.is_owner === 1,
    subscriberCount: creator.subscriber_count,
    title: creator.title,
  })) ?? [], [data?.creators]);
  const playlistVideos = useMemo<PlaylistVideo[]>(() => items.map((item, index) => ({
    channelTitle: item.channel_title,
    duration: item.duration ?? "",
    index,
    publishedAt: item.published_at,
    thumbnail: item.thumbnail,
    title: item.title,
    videoId: item.video_id,
    watch_duration: null,
    watch_position: null,
    watched: 0,
  })), [items]);

  useEffect(() => {
    activePlaylistItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentIndex]);

  useEffect(() => {
    document.body.classList.toggle("cinema", cinemaMode);
    if (cinemaMode) {
      requestAnimationFrame(() => requestAnimationFrame(() => setCinemaVisible(true)));
    } else {
      setCinemaVisible(false);
    }
    return () => document.body.classList.remove("cinema");
  }, [cinemaMode]);

  useEffect(() => {
    const onScroll = () => setTopbarSolid(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const bindings = resolveShortcutBindings(undefined);
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as Element).closest("input,textarea,select,[contenteditable]")) return;
      if (shortcutActionMatches("toggleTheater", event, bindings)) {
        event.preventDefault();
        if (!event.repeat) setCinemaMode((value) => !value);
      } else if (shortcutActionMatches("previousVideo", event, bindings)) {
        event.preventDefault();
        if (!event.repeat && previous) openVideo(previous.video_id);
      } else if (shortcutActionMatches("nextVideo", event, bindings)) {
        event.preventDefault();
        if (!event.repeat && next) openVideo(next.video_id);
      } else if (data?.playback?.kind === "youtube" && shortcutActionMatches("toggleFullscreen", event, bindings)) {
        event.preventDefault();
        if (event.repeat) return;
        if (!document.fullscreenElement) void playerShellRef.current?.requestFullscreen?.();
        else void document.exitFullscreen?.();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [data?.playback?.kind, next, openVideo, previous]);

  if (error === "expired" || error === "plays_exhausted") return <main className="public-share-state"><EmptyState
    icon={<TimerOff />}
    title={t("publicShareExpired")}
    description={t(error === "plays_exhausted" ? "publicShareExpiredPlaysHint" : "publicShareExpiredHint")}
  /></main>;
  if (error) return <main className="public-share-state"><EmptyState
    icon={<ListVideo />}
    title={t(error === "rate_limited" ? "publicShareRateLimited" : "publicShareUnavailable")}
    description={t(error === "rate_limited" ? "publicShareRateLimitedHint" : "publicShareUnavailableHint")}
  /></main>;
  if (!data) return <main className="public-share-state" aria-busy="true"><LoaderCircle className="spin" /><span>{t("publicShareLoading")}</span></main>;

  const video = data.video;
  // Server streaming plays in the local player over HLS; if it fails, the
  // same video falls back to the YouTube embed.
  const playback = data.playback?.kind === "stream" && streamFailedFor === data.playback.video_id
    ? { kind: "youtube" as const, video_id: data.playback.video_id }
    : data.playback;
  return <div className="public-share-page">
    <header className={`topbar public-share-header${topbarSolid ? " topbar--solid" : ""}`}>
      <div className="topbar-logo">
        <span className="logo-mark" style={{ background: data.brand.color }} aria-hidden="true">
          <span className="topbar-logo-default-icon"><Play fill="currentColor" /></span>
        </span>
        <span className="logo-text">{data.brand.name}</span>
      </div>
      <span className="public-share-label">{t("publicSharePublicLink")}</span>
    </header>
    <main className="public-share-content">
      <div className={`watch-layout public-share-watch-layout${cinemaMode ? " theater" : ""}${data.resource.type === "video" ? " public-share-watch-layout--single" : ""}`}>
        <div>
          <div className="watch-player-stage">
            <div className="cinema-player-wrap">
              {video && <div
                className="player-glow"
                style={{ backgroundImage: `url(${video.thumbnail})`, opacity: cinemaVisible ? 0.6 : 0 }}
              />}
              <div ref={playerShellRef} className="watch-player-shell">
                {video && (playback?.kind === "local" || playback?.kind === "stream") && <div className="watch-player watch-player--local">
                  <LocalPlayer
                    key={`${video.video_id}:${playback.url}`}
                    ref={playerRef}
                    src={playback.url}
                    hls={playback.kind === "stream"}
                    durationSeconds={playback.kind === "stream" ? parseVideoDurationSeconds(video.duration) ?? undefined : undefined}
                    onError={playback.kind === "stream" ? () => setStreamFailedFor(video.video_id) : undefined}
                    poster={video.thumbnail}
                    autoplay={false}
                    startSeconds={startSeconds}
                    title={video.title}
                    channelTitle={video.channel_title}
                    artworkUrl={video.thumbnail}
                    videoId={video.video_id}
                    chapters={data.chapters}
                    cinemaMode={cinemaMode}
                    subtitleCatalog={data.subtitles}
                    keyboardSeekSeconds={KEYBOARD_SEEK_SECONDS}
                    onToggleCinema={() => setCinemaMode((value) => !value)}
                    onShortcut={showShortcutFeedback}
                    onPrevious={previous ? () => openVideo(previous.video_id) : undefined}
                    onNext={next ? () => openVideo(next.video_id) : undefined}
                    onEnded={next ? () => openVideo(next.video_id) : undefined}
                  />
                  {feedback && <WatchPlayerFeedback key={feedback.id} feedback={feedback} keyboardSeekSeconds={KEYBOARD_SEEK_SECONDS} />}
                </div>}
                {video && playback?.kind === "youtube" && <PublicYouTubePlayer
                  key={video.video_id}
                  ref={playerRef}
                  chapters={data.chapters}
                  onEnded={next ? () => openVideo(next.video_id) : undefined}
                  startSeconds={startSeconds}
                  title={video.title}
                  videoId={video.video_id}
                />}
                {!video && <div className="watch-player wp-panel"><div className="wp-panel-content"><EmptyState icon={<ListVideo />} title={t("publicShareEmptyPlaylist")} description={t("publicShareEmptyPlaylistHint")} /></div></div>}
              </div>
            </div>
          </div>
          {video && <>
            <div className="watch-title-row"><h1 className="watch-title">{video.title}</h1></div>
            <div className="watch-row">
              <div className="watch-channel"><VideoCreators creators={creators} linkChannels={false} /></div>
              <div className="watch-actions">
                <IconButton variant={cinemaMode ? "secondary" : "default"} label={t("cinemaMode")} aria-pressed={cinemaMode} onClick={() => setCinemaMode((value) => !value)}><Clapperboard size={15} /></IconButton>
              </div>
            </div>
            <WatchVideoDescription
              baseUrl={window.location.origin}
              description={video.description}
              likes={video.likes}
              linkMode="external"
              publishedAt={video.published_at}
              videoId={video.video_id}
              views={video.views}
            />
            {data.chapters.length > 0 && <div className="watch-panels"><WatchChapterPanel chapters={data.chapters} onSeek={(seconds) => playerRef.current?.seekTo(seconds, true)} /></div>}
          </>}
        </div>
        {data.resource.type !== "video" && <aside>
          <WatchPlaylistPanel
            activeItemRef={activePlaylistItemRef}
            currentVideoId={video?.video_id}
            footer={data.has_more ? <Button disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? t("publicShareLoading") : t("publicShareLoadMore")}</Button> : undefined}
            itemsRef={playlistItemsRef}
            playlistIndex={currentIndex}
            title={data.resource.title}
            totalCount={data.resource.video_count}
            toVideo={(item) => `/share/${token}/video/${item.videoId}`}
            videos={playlistVideos}
          />
        </aside>}
      </div>
    </main>
  </div>;
}

export default function PublicSharePage() {
  return <Routes>
    <Route path="/share/:token" element={<PublicShareView />} />
    <Route path="/share/:token/video/:videoId" element={<PublicShareView />} />
    <Route path="*" element={<PublicShareNotFound />} />
  </Routes>;
}

function PublicShareNotFound() {
  const { t } = useI18n();
  return <main className="public-share-state"><EmptyState icon={<ListVideo />} title={t("publicShareNotFound")} /></main>;
}
