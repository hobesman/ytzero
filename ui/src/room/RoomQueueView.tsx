import { useCallback } from "react";
import { History, ListMusic, Radio } from "lucide-react";
import { useI18n } from "../i18n";
import { EmptyState, MenuLoading, SectionHeader } from "../components/ui";
import type { MusicTrack } from "../music/musicApi";
import { MusicNote, MusicTrackList, useMusicData } from "../music/MusicParts";
import { roomApi, type AlexaSkill, type RoomHistoryItem } from "./roomApi";

/** A song in a room list as the music page's track rows show it. */
function asTrack(song: { videoId: string; title: string; artist: string; art: string; durationMs: number | null }): MusicTrack {
  return {
    videoId: song.videoId, title: song.title, artist: song.artist, artistId: null, album: null,
    duration: song.durationMs ? Math.round(song.durationMs / 1000) : null, thumbnail: song.art || null, isTopic: false, rating: null,
  };
}

/**
 * What this room's Echo played lately: its own list, not the profile's whole
 * history, which mixes in every device. Tapping an item plays it here again.
 */
export function RoomRecentlyPlayed({ roomName, skill, playingId, onPlay, children }: {
  roomName: string; skill: AlexaSkill; playingId: string | null;
  onPlay?: (item: RoomHistoryItem, index: number, items: RoomHistoryItem[]) => void;
  /** Draws the items, for a skill whose rows aren't songs. */
  children?: (items: RoomHistoryItem[]) => React.ReactNode;
}) {
  const { t } = useI18n();
  const recent = useMusicData(useCallback(() => roomApi.history(roomName, skill), [roomName, skill]));
  return <section className="music-shelf">
    <SectionHeader title={t("roomRecentHere", { room: roomName })} level={2} />
    {recent.failed ? <MusicNote text={t("roomQueueLoadFailed")} onRetry={recent.retry} />
      : !recent.data ? <MenuLoading label={t("loading")} />
      : !recent.data.length ? <EmptyState compact icon={<History />} title={t("roomRecentEmpty", { room: roomName })} />
      : children ? children(recent.data)
      : <MusicTrackList menu={false} tracks={recent.data.map((item) => asTrack({ ...item, videoId: item.itemId, durationMs: null }))} playingId={playingId}
        onPlay={(_track, index) => onPlay?.(recent.data![index]!, index, recent.data!)} />}
  </section>;
}

/** The music tab's queue: what plays next in the room, and what played there lately. */
export function RoomMusicQueue({ roomName, playingId, onPlaySongs }: {
  roomName: string; playingId: string | null;
  /** Plays these songs in the room, from the first. */
  onPlaySongs: (tracks: MusicTrack[], from: number, title: string) => void;
}) {
  const { t } = useI18n();
  const upcoming = useMusicData(useCallback(() => roomApi.upcoming(roomName), [roomName]));
  const songs = upcoming.data?.songs.map(asTrack) ?? [];
  return <>
    <section className="music-shelf">
      <SectionHeader title={t("roomUpNext")} level={2} description={upcoming.data?.playing ? undefined : t("roomUpNextIdle", { room: roomName })} />
      {upcoming.failed ? <MusicNote text={t("roomQueueLoadFailed")} onRetry={upcoming.retry} />
        : !upcoming.data ? <MenuLoading label={t("loading")} />
        : songs.length ? <MusicTrackList menu={false} tracks={songs} playingId={playingId} onPlay={(_track, index) => onPlaySongs(songs, index, t("roomUpNext"))} />
        : upcoming.data.playing ? null : <EmptyState compact icon={<ListMusic />} title={t("roomUpNextNothing")} />}
      {upcoming.data?.playing && upcoming.data.station
        ? <p className="room-music__hint room-queue__station"><Radio aria-hidden="true" />{t("roomUpNextStation")}</p> : null}
    </section>
    <RoomRecentlyPlayed roomName={roomName} skill="music" playingId={playingId}
      onPlay={(_item, index, items) => onPlaySongs(items.map((item) => asTrack({ ...item, videoId: item.itemId, durationMs: null })), index, t("roomRecentHere", { room: roomName }))} />
  </>;
}
