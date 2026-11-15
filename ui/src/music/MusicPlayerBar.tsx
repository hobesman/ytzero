import { Heart, Pause, Play, SkipBack, SkipForward, Square, ThumbsDown } from "lucide-react";
import { useI18n } from "../i18n";
import { IconButton, Slider } from "../components/ui";
import { MusicArtwork, durationLabel } from "./MusicParts";
import { musicPlayer, useMusicPlayer } from "./musicPlayer";
import { current, fromTitle } from "./musicQueue";

/** The music now playing, with its controls; shown under music mode's pages. */
export default function MusicPlayerBar() {
  const { t } = useI18n();
  const state = useMusicPlayer();
  const track = current(state.queue);
  if (!track) return null;
  const from = fromTitle(state.queue);
  const liked = track.rating === 1;
  const duration = state.duration || track.duration || 0;
  return <div className="music-bar" role="region" aria-label={t("navMusic")}>
    <div className="music-bar__track">
      <MusicArtwork url={track.thumbnail} size={52} />
      <div className="music-bar__copy">
        <span className="music-bar__title">{track.title}</span>
        <span className="music-bar__detail">{from ? t("musicFrom", { title: from }) : track.artist}</span>
      </div>
    </div>
    <div className="music-bar__controls">
      <IconButton variant="ghost" label={t("musicPrevious")} icon={<SkipBack />} onClick={() => musicPlayer.previous()} />
      <IconButton variant="primary" label={state.playing ? t("musicPause") : t("musicPlay")} icon={state.playing ? <Pause /> : <Play />}
        onClick={() => musicPlayer.toggle()} disabled={state.loading && !state.playing} />
      <IconButton variant="ghost" label={t("musicNext")} icon={<SkipForward />} onClick={() => musicPlayer.next()} />
    </div>
    <div className="music-bar__progress">
      <span className="music-bar__time">{durationLabel(state.position) || "0:00"}</span>
      <Slider aria-label={t("musicPosition")} min={0} max={Math.max(1, Math.round(duration))} value={Math.min(Math.round(state.position), Math.round(duration) || 1)}
        onChange={(value) => musicPlayer.seek(Number(value))} />
      <span className="music-bar__time">{durationLabel(duration)}</span>
    </div>
    <div className="music-bar__actions">
      <IconButton variant="ghost" label={liked ? t("musicUnlike") : t("musicLike")} icon={<Heart fill={liked ? "currentColor" : "none"} />}
        onClick={() => void musicPlayer.rate(track, liked ? 0 : 1).catch(() => {})} />
      <IconButton variant="ghost" label={t("musicNotThis")} icon={<ThumbsDown />} onClick={() => void musicPlayer.dislike(track).catch(() => {})} />
      <IconButton variant="ghost" label={t("musicStop")} icon={<Square />} onClick={() => musicPlayer.stop()} />
    </div>
  </div>;
}
