import { useState } from "react";
import { ChevronDown, ChevronUp, ListMusic, X } from "lucide-react";
import { useI18n } from "../i18n";
import { EmptyState, FloatingPopover, IconButton, List, ListRow, ScrollArea } from "../components/ui";
import { MusicArtwork } from "./MusicParts";
import { musicPlayer, useMusicPlayer } from "./musicPlayer";
import "./MusicQueueParts.css";

/** The player bar's Up next: the songs still to come, to play, reorder or take out. */
export function MusicUpNext() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { queue } = useMusicPlayer();
  const first = (queue?.index ?? 0) + 1;
  const upcoming = queue ? queue.tracks.slice(first) : [];
  const trigger = <IconButton variant="ghost" label={t("musicUpNext")} aria-pressed={open} icon={<ListMusic />} />;
  return <FloatingPopover open={open} onOpenChange={setOpen} align="end" trigger={trigger}>
    <section className="music-up-next" aria-label={t("musicUpNext")}>
      <div className="ui-popover__title">{t("musicUpNext")}</div>
      {!upcoming.length ? <EmptyState compact icon={<ListMusic />} title={t("musicUpNextEmpty")} /> : <ScrollArea viewportClassName="music-up-next__scroll">
        <List>{upcoming.map((track, offset) => {
          const at = first + offset;
          return <ListRow key={track.videoId} className="music-up-next__row" role="button" tabIndex={0}
            onClick={() => musicPlayer.jumpTo(at)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              musicPlayer.jumpTo(at);
            }}
            media={<MusicArtwork url={track.thumbnail} size={40} />} title={track.title} description={track.artist}
            actions={<span className="music-up-next__actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
              <IconButton size="sm" variant="ghost" label={t("musicMoveUp")} icon={<ChevronUp />} disabled={offset === 0} onClick={() => musicPlayer.moveUpcoming(at, at - 1)} />
              <IconButton size="sm" variant="ghost" label={t("musicMoveDown")} icon={<ChevronDown />} disabled={offset === upcoming.length - 1} onClick={() => musicPlayer.moveUpcoming(at, at + 1)} />
              <IconButton size="sm" variant="ghost" label={t("musicRemoveFromQueue")} icon={<X />} onClick={() => musicPlayer.removeUpcoming(at)} />
            </span>} />;
        })}</List>
      </ScrollArea>}
    </section>
  </FloatingPopover>;
}
