import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Play, Shuffle, Sparkles, X } from "lucide-react";
import { api, type SearchResult, type Video } from "../api";
import { useI18n } from "../i18n";
import { img, videoThumbnail } from "../img";
import { Alert, Button, EmptyState, List, ListRow, MenuLoading, SectionHeader } from "../components/ui";
import { useMusicData } from "../music/MusicParts";
import { roomApi, type RoomVideoRequest } from "./roomApi";
import type { RoomCommand } from "./useRoomState";
import { RoomSearchBox } from "./RoomSearchBox";
import { RoomRecentlyPlayed } from "./RoomQueueView";
import { roomArtSource } from "./roomState";

/** How many of the room's recent videos the tab lists. */
const RECENT_HERE = 8;

/** Audio can't be served for live, upcoming, private, unavailable or members-only videos, nor Shorts. */
const playable = (video: Video) => video.is_short !== 1 && !video.is_private && !video.is_unavailable && !video.members_only
  && (video.live_status === "none" || video.live_status === "was_live");

function VideoRows({ videos, roomName, onPlay }: { videos: Video[]; roomName: string; onPlay: (video: Video) => void }) {
  const { t } = useI18n();
  return <List className="room-videos__list">
    {videos.map((video) => <ListRow key={video.video_id} className="room-videos__row"
      media={<img className="room-videos__thumb" src={videoThumbnail(video.thumbnail)} alt="" loading="lazy" />}
      title={video.title} description={video.channel_title}
      actions={<Button size="lg" variant="primary" leadingIcon={<Play />} onClick={() => onPlay(video)}>{t("roomPlayIn", { room: roomName })}</Button>} />)}
  </List>;
}

/** A search result that has audio: live streams and premieres come back without a length. */
const searchPlayable = (result: SearchResult) => /\d/.test(result.duration ?? "");

/**
 * YouTube search, through YT Zero. A result from a followed channel plays as
 * any library video does; one YT Zero doesn't have is asked for by its title
 * and channel, which the skill finds with its own YouTube search.
 */
function VideoSearchResults({ query, roomName, onPlay, onClear }: {
  query: string; roomName: string; onPlay: (result: SearchResult) => void; onClear: () => void;
}) {
  const { t } = useI18n();
  const results = useMusicData(useCallback(() => api.youtubeSearch(query).then((answer) => answer.results.filter(searchPlayable).slice(0, 20)), [query]));
  return <section className="music-shelf">
    <SectionHeader title={t("roomVideoResults", { query })} level={2}
      actions={<Button size="lg" variant="ghost" leadingIcon={<X />} onClick={onClear}>{t("roomSearchClear")}</Button>} />
    {results.failed ? <EmptyState compact icon={<Play />} title={t("roomVideoSearchFailed")} action={<Button size="lg" onClick={results.retry}>{t("musicRetry")}</Button>} />
      : !results.data ? <MenuLoading label={t("loading")} />
      : !results.data.length ? <EmptyState compact icon={<Play />} title={t("roomVideoNoResults")} />
      : <List className="room-videos__list">
        {results.data.map((result) => <ListRow key={result.videoId} className="room-videos__row"
          media={<img className="room-videos__thumb" src={videoThumbnail(result.thumbnail)} alt="" loading="lazy" />}
          title={result.title} description={[result.channelTitle, result.duration].filter(Boolean).join(" · ")}
          actions={<Button size="lg" variant="primary" leadingIcon={<Play />} onClick={() => onPlay(result)}>{t("roomPlayIn", { room: roomName })}</Button>} />)}
      </List>}
  </section>;
}

/**
 * Hoban Tube for the room: the video skill has no queue, so each button types
 * the Echo a request ("ask hoban tube to play the video … from …"), the way
 * someone would say it. Videos resume where the profile left off.
 */
export function RoomVideoTab({ roomName, onCommand }: { roomName: string; onCommand: RoomCommand }) {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search).get("q")?.trim() ?? "";
  const search = (text: string) => navigate(`${location.pathname}?q=${encodeURIComponent(text)}`);
  const [failure, setFailure] = useState<string | null>(null);
  const inProgress = useMusicData(useCallback(() => api.inProgress().then((result) => result.videos.filter(playable).slice(0, 8)), []));
  const recent = useMusicData(useCallback(() => api.feed({ limit: 24, shorts: false }).then((result) => result.videos.filter(playable).slice(0, 16)), []));
  const channels = useMusicData(useCallback(() => api.channels().then((result) => result.channels.filter((channel) => channel.followed !== 0)
    .sort((a, b) => (b.latest_video_at ?? "").localeCompare(a.latest_video_at ?? "")).slice(0, 24)), []));

  const play = (request: RoomVideoRequest) => {
    setFailure(null);
    void onCommand(roomName, "play", () => roomApi.playVideo(roomName, request))
      .then((error) => { if (error) setFailure(t("roomCommandFailed", { room: roomName, error })); });
  };
  const playVideo = (video: Video) => play({ kind: "video", videoId: video.video_id });

  const nothing = inProgress.data?.length === 0 && recent.data?.length === 0 && channels.data?.length === 0;
  const header = <>
    <RoomSearchBox value={query} placeholder={t("roomVideoSearchPlaceholder")} onSearch={search} />
    <p className="room-music__hint">{t("roomVideosHint")}</p>
    {failure ? <Alert variant="danger" role="alert" className="room-tab__failure">{failure}</Alert> : null}
  </>;
  if (query) return <div className="room-videos">
    {header}
    <VideoSearchResults query={query} roomName={roomName} onClear={() => navigate(location.pathname)}
      onPlay={(result) => play({ kind: "video", videoId: result.videoId, title: result.title, channel: result.channelTitle })} />
  </div>;
  return <div className="room-videos">
    {header}
    {inProgress.data?.length ? <section className="music-shelf">
      <SectionHeader title={t("roomVideosContinue")} level={2} />
      <VideoRows videos={inProgress.data} roomName={roomName} onPlay={playVideo} />
    </section> : null}
    {/* Hoban Tube has no queue to show; what this room's Echo played lately stands in for one. */}
    <RoomRecentlyPlayed roomName={roomName} skill="video" playingId={null}>
      {(items) => <List className="room-videos__list">
        {items.slice(0, RECENT_HERE).map((item) => <ListRow key={item.itemId} className="room-videos__row"
          media={<img className="room-videos__thumb" src={roomArtSource(item.art) ?? ""} alt="" loading="lazy" />}
          title={item.title} description={item.artist}
          actions={<Button size="lg" variant="primary" leadingIcon={<Play />} onClick={() => play({ kind: "video", videoId: item.itemId })}>{t("roomPlayIn", { room: roomName })}</Button>} />)}
      </List>}
    </RoomRecentlyPlayed>
    {channels.data?.length ? <section className="music-shelf">
      <SectionHeader title={t("roomVideosChannels")} level={2} />
      <List className="room-videos__list">
        {channels.data.map((channel) => <ListRow key={channel.channel_id} className="room-videos__row"
          media={<img className="room-videos__avatar" src={img(channel.thumbnail)} alt="" loading="lazy" />}
          title={channel.custom_title || channel.title}
          actions={<>
            <Button size="lg" variant="primary" leadingIcon={<Sparkles />} onClick={() => play({ kind: "latest", channelId: channel.channel_id })}>{t("roomVideoLatest")}</Button>
            <Button size="lg" leadingIcon={<Shuffle />} onClick={() => play({ kind: "shuffle", channelId: channel.channel_id })}>{t("roomVideoShuffle")}</Button>
          </>} />)}
      </List>
    </section> : null}
    {recent.data?.length ? <section className="music-shelf">
      <SectionHeader title={t("roomVideosRecent")} level={2} />
      <VideoRows videos={recent.data} roomName={roomName} onPlay={playVideo} />
    </section> : null}
    {nothing ? <EmptyState compact icon={<Play />} title={t("roomVideosEmpty")} /> : null}
  </div>;
}
