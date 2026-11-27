import { useCallback, useState } from "react";
import { Play, Shuffle, Sparkles } from "lucide-react";
import { api, type Video } from "../api";
import { useI18n } from "../i18n";
import { img, videoThumbnail } from "../img";
import { Alert, Button, EmptyState, List, ListRow, SectionHeader } from "../components/ui";
import { useMusicData } from "../music/MusicParts";
import { roomApi, type RoomVideoRequest } from "./roomApi";
import type { RoomCommand } from "./useRoomState";

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

/**
 * Hoban Tube for the room: the video skill has no queue, so each button types
 * the Echo a request ("ask hoban tube to play the video … from …"), the way
 * someone would say it. Videos resume where the profile left off.
 */
export function RoomVideoTab({ roomName, onCommand }: { roomName: string; onCommand: RoomCommand }) {
  const { t } = useI18n();
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
  return <div className="room-videos">
    <p className="room-music__hint">{t("roomVideosHint")}</p>
    {failure ? <Alert variant="danger" role="alert" className="room-tab__failure">{failure}</Alert> : null}
    {inProgress.data?.length ? <section className="music-shelf">
      <SectionHeader title={t("roomVideosContinue")} level={2} />
      <VideoRows videos={inProgress.data} roomName={roomName} onPlay={playVideo} />
    </section> : null}
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
