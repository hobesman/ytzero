import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, BackHandler, FlatList, Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import { createVideoPlayer, VideoView, type VideoPlayer } from "expo-video";
import Svg, { Path } from "react-native-svg";
import type { YtZeroApi } from "../api";
import { TvChoiceSheet } from "../components/TvChoiceSheet";
import type { Translate } from "../i18n";
import { PlaybackProgress, type PlaybackPosition } from "../playback";
import { PlaybackBuffer, type BufferedPlayback } from "../playbackBuffer";
import { playableSpeed, speedLabel, speedMemoryTarget, speedOptions } from "../playbackSpeeds";
import { pausePlayer, playPlayer, seekPlayer, unloadPlayer } from "../playerControl";
import { setPhoneImmersive } from "../phoneOrientation";
import { appendShorts, loadedShorts, pageAt, wantsMoreShorts, type ShortsSession } from "../shortsSession";
import type { TvProfileSettings, Video } from "../types";
import { useKeepScreenAwake } from "../useKeepScreenAwake";
import { ShortThumbnail, useShortThumbnail, type ShortSources } from "./PhoneShorts";
import { phoneColors, phoneType } from "./phoneTheme";

type Props = {
  api: YtZeroApi; t: Translate; session: ShortsSession; incognito: boolean; isChild: boolean;
  onClose: () => void; onOpenChannel: (channelId: string) => void;
  onVideoLongPress: (video: Video, onChange: (updated: Video) => void) => void;
  /** A Short's saved progress, for the screens below to show. */
  onVideoChange: (video: Video) => void;
};

type Session = {
  entry: BufferedPlayback; progress: PlaybackProgress; position: PlaybackPosition;
  didPlay: boolean; completed: boolean; history: Promise<boolean> | null; finished: boolean;
};

/**
 * The phone's Shorts player: full screen, portrait, one Short per page, and a
 * swipe up or down moves to the next or previous one. The Shorts a swipe away
 * are already loaded (muted and paused) by the same playback buffer as the
 * regular player, so the next one appears at once. A Short loops; it counts as
 * watched the first time it reaches the end. Shorts don't play in the
 * background or in the mini player.
 */
export function PhoneShortsPlayer(props: Props) {
  const { api, t, incognito, isChild } = props;
  const latest = useRef(props);
  latest.current = props;
  const [items, setItems] = useState(props.session.items);
  const [index, setIndex] = useState(props.session.index);
  const [pageHeight, setPageHeight] = useState(0);
  const list = useRef<FlatList<Video>>(null);
  const [entries, setEntries] = useState<ReadonlyMap<string, BufferedPlayback>>(new Map());
  const [active, setActive] = useState<BufferedPlayback | null>(null);
  const [playing, setPlaying] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rate, setRate] = useState(1);
  const [speedSheet, setSpeedSheet] = useState(false);
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set());
  const userPausedRef = useRef(false);
  const session = useRef<Session | null>(null);
  const loadingMore = useRef(false);
  const exhausted = useRef(!props.session.loadMore);
  const settings = useRef<TvProfileSettings | null>(null);
  // The profile's default speed must be known before the first Short starts.
  const settingsLoaded = useMemo(() => api.settings().then(({ settings: value }) => { settings.current = value; }, () => {}), [api]);

  const buffer = useMemo(() => new PlaybackBuffer(api, () => {
    const player = createVideoPlayer(null);
    player.timeUpdateEventInterval = 0.25;
    player.preservesPitch = true;
    player.audioMixingMode = "doNotMix";
    player.bufferOptions = { preferredForwardBufferDuration: 5, maxBufferBytes: 8 * 1024 * 1024 };
    return player;
  }, seekPlayer, (entry) => setFailedIds((current) => new Set(current).add(entry.video.video_id)), unloadPlayer,
  { play: playPlayer, pause: pausePlayer }, () => settings.current?.player_speed), [api]);

  const finish = (current: Session) => {
    if (current.finished) return;
    current.finished = true;
    const duration = current.position.duration || current.entry.player.duration;
    const value = current.completed && duration > 0 ? { position: duration, duration } : current.didPlay ? current.position : { position: 0, duration: 0 };
    void Promise.all([current.progress.finish(value, current.completed), current.history]).then(([failed]) => {
      if (failed || value.duration <= 0 || (incognito && !isChild)) return;
      latest.current.onVideoChange({ ...current.entry.video, watch_position: value.position, watch_duration: value.duration, watched: current.completed ? 1 : current.entry.video.watched });
    });
  };

  // The Short on screen plays; its neighbours load. A new Short starts from the beginning.
  useEffect(() => {
    const video = items[index];
    if (!video) return;
    const loaded = loadedShorts(items, index);
    buffer.retain(loaded.map((item) => item.video_id));
    const map = new Map(loaded.map((item) => [item.video_id, buffer.prepare(item, 0)] as const));
    setEntries(map);
    const entry = map.get(video.video_id)!;
    if (session.current?.entry === entry) return;
    if (session.current) finish(session.current);
    const id = video.video_id;
    session.current = {
      entry, position: { position: 0, duration: 0 }, didPlay: false, completed: false, history: null, finished: false,
      progress: new PlaybackProgress(!incognito || isChild, (value) => api.savePlaybackProgress(id, value), () => api.markWatched(id)),
    };
    userPausedRef.current = false;
    setUserPaused(false);
    setActive(entry);
    setProgress(0);
    void Promise.all([entry.ready, settingsLoaded]).then(async () => {
      if (session.current?.entry !== entry) return;
      if (entry.player.currentTime > 0.5) await seekPlayer(entry.player, 0);
      if (session.current?.entry === entry && !userPausedRef.current && AppState.currentState === "active") await buffer.play(entry);
    }).catch(() => {});
  }, [buffer, index, items]);

  useEffect(() => {
    if (!active) return;
    const player = active.player;
    setRate(player.playbackRate);
    setPlaying(player.playing);
    const subscriptions = [
      player.addListener("playbackRateChange", ({ playbackRate }) => setRate(playbackRate)),
      player.addListener("playingChange", ({ isPlaying }) => {
        setPlaying(isPlaying);
        const current = session.current;
        if (current?.entry === active && !isPlaying && current.didPlay && !current.finished) current.progress.update(current.position);
      }),
      player.addListener("timeUpdate", ({ currentTime }) => {
        const current = session.current;
        if (!current || current.entry !== active || current.finished) return;
        if (player.playing && currentTime > 0) {
          current.didPlay = true;
          if ((!incognito || isChild) && !current.history) current.history = api.recordPlayback(active.video.video_id, null).then(() => false, () => true);
        }
        const duration = player.duration;
        if (duration > 0) {
          current.position = { position: currentTime, duration };
          setProgress(Math.min(1, currentTime / duration));
        }
        // Taken from each update too: the playing event can be missed while a neighbour turns into the Short on screen.
        setPlaying(player.playing);
      }),
      // Shorts loop. The first time through counts as watched.
      player.addListener("playToEnd", () => {
        const current = session.current;
        if (!current || current.entry !== active || current.finished) return;
        // Android's ExoPlayer can report "ended" before the source has loaded.
        if (!current.didPlay && !(player.duration > 0)) return;
        current.completed = true;
        void seekPlayer(player, 0).then(() => { if (session.current === current && !userPausedRef.current) void playPlayer(player); });
      }),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [active, api, incognito, isChild]);

  useEffect(() => {
    const interval = setInterval(() => {
      const current = session.current;
      if (current?.entry.player.playing && current.didPlay && !current.finished) current.progress.update(current.position);
      if (isChild) void api.playbackRestriction().then((status) => { if (status.locked) latest.current.onClose(); }).catch(() => latest.current.onClose());
    }, 5000);
    const state = AppState.addEventListener("change", (value) => {
      const current = session.current;
      if (!current) return;
      if (value === "background") {
        void buffer.pause().catch(() => {});
        if (current.didPlay && !current.finished) current.progress.update(current.position);
      } else if (value === "active" && !userPausedRef.current) void buffer.play(current.entry).catch(() => {});
    });
    return () => { clearInterval(interval); state.remove(); };
  }, [api, buffer, isChild]);

  useEffect(() => () => {
    if (session.current) finish(session.current);
    buffer.dispose();
  }, [buffer]);

  useEffect(() => {
    setPhoneImmersive(true);
    const back = BackHandler.addEventListener("hardwareBackPress", () => { latest.current.onClose(); return true; });
    return () => { back.remove(); setPhoneImmersive(false); };
  }, []);
  useKeepScreenAwake(playing);
  // The height changes once immersive mode hides the system bars; keep the Short on screen aligned.
  useEffect(() => { if (pageHeight > 0) list.current?.scrollToOffset({ offset: index * pageHeight, animated: false }); }, [pageHeight]);

  // More Shorts as the viewer nears the end of the list.
  useEffect(() => {
    const loadMore = latest.current.session.loadMore;
    if (!loadMore || exhausted.current || loadingMore.current || !wantsMoreShorts(items.length, index)) return;
    loadingMore.current = true;
    void loadMore().then((more) => {
      setItems((current) => {
        const next = appendShorts(current, more);
        if (next === current) exhausted.current = true;
        return next;
      });
    }).catch(() => {}).finally(() => { loadingMore.current = false; });
  }, [index, items.length]);

  const togglePause = useCallback(() => {
    const entry = session.current?.entry;
    if (!entry) return;
    if (entry.player.playing) {
      userPausedRef.current = true;
      setUserPaused(true);
      void buffer.pause().catch(() => {});
    } else {
      userPausedRef.current = false;
      setUserPaused(false);
      void buffer.play(entry).catch(() => {});
    }
  }, [buffer]);

  // With "remember speed changes" on, a speed picked here outlasts this Short.
  const chooseSpeed = (value: string) => {
    setSpeedSheet(false);
    const entry = session.current?.entry;
    const speed = playableSpeed(value);
    if (!entry || speed === null) return;
    entry.player.playbackRate = speed;
    const target = speedMemoryTarget(settings.current?.player_speed_remember, entry.video.channel_playback_speed, false);
    const channelId = entry.video.channel_id;
    if (target === "channel" && channelId) {
      entry.video = { ...entry.video, channel_playback_speed: value };
      void api.setChannelSpeed(channelId, value).catch(() => {});
    } else if (target === "default") {
      if (settings.current) settings.current = { ...settings.current, player_speed: value };
      void api.updateSettings({ player_speed: value }).catch(() => {});
    }
  };

  const settle = (offset: number) => {
    setDragging(false);
    const next = pageAt(offset, pageHeight, items.length);
    if (next !== index) setIndex(next);
  };
  const thumbnail = useShortThumbnail(api);

  const video = items[index];
  const failed = video ? failedIds.has(video.video_id) && Boolean(entries.get(video.video_id)?.error) : false;
  const avatar = video?.channel_thumbnail ? api.thumbnailSource(video.channel_thumbnail) as ImageSourcePropType : null;
  return <View style={styles.screen} onLayout={({ nativeEvent }) => setPageHeight(nativeEvent.layout.height)}>
    {pageHeight > 0 ? <FlatList ref={list} data={items} keyExtractor={(item) => item.video_id}
      renderItem={({ item }) => <ShortPage height={pageHeight} player={entries.get(item.video_id)?.player ?? null} thumbnail={thumbnail(item)} onPress={togglePause} />}
      extraData={entries} pagingEnabled showsVerticalScrollIndicator={false} decelerationRate="fast"
      getItemLayout={(_, position) => ({ length: pageHeight, offset: pageHeight * position, index: position })}
      initialScrollIndex={props.session.index} initialNumToRender={2} windowSize={3} maxToRenderPerBatch={2}
      onScrollBeginDrag={() => setDragging(true)}
      // A drag released without a fling may end without momentum; the page it rests on still counts.
      onScrollEndDrag={({ nativeEvent }) => { if (nativeEvent.contentOffset.y % pageHeight === 0) settle(nativeEvent.contentOffset.y); }}
      onMomentumScrollEnd={({ nativeEvent }) => settle(nativeEvent.contentOffset.y)} /> : null}
    {video ? <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, dragging && styles.hidden]}>
      <Pressable hitSlop={12} accessibilityRole="button" accessibilityLabel={t("back")} onPress={props.onClose}
        style={[styles.back, { top: 8 }]}><Text style={styles.backGlyph}>‹</Text></Pressable>
      {failed ? <View pointerEvents="none" style={styles.center}><Text style={styles.error}>{t("playbackError")}</Text></View>
        : userPaused ? <View pointerEvents="none" style={styles.center}><View style={styles.playCircle}>
          <Svg width={40} height={40} viewBox="0 0 24 24"><Path fill="#fff" d="M8 5.5v13l10.5-6.5z" /></Svg></View></View>
        : !playing ? <View pointerEvents="none" style={styles.center}><ActivityIndicator color="#fff" size="large" /></View> : null}
      <View pointerEvents="box-none" style={[styles.bottom, { paddingBottom: 18 }]}>
        <View pointerEvents="box-none" style={styles.copy}>
          <Pressable accessibilityRole="button" accessibilityLabel={video.channel_title} disabled={!video.channel_id}
            onPress={() => video.channel_id && props.onOpenChannel(video.channel_id)} style={styles.channel}>
            {avatar ? <Image source={avatar} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.letter}>{(video.channel_title || "?").slice(0, 1)}</Text></View>}
            <Text numberOfLines={1} style={styles.channelName}>{video.channel_title}</Text>
          </Pressable>
          <Text numberOfLines={2} style={styles.title}>{video.title}</Text>
        </View>
        <View style={styles.side}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${t("playbackSpeed")}: ${speedLabel(rate)}`} onPress={() => setSpeedSheet(true)} style={styles.sideButton}>
            <Text style={styles.sideText}>{speedLabel(rate)}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t("more")} style={styles.sideButton}
            onPress={() => props.onVideoLongPress(video, (updated) => setItems((current) => current.map((item) => item.video_id === updated.video_id ? updated : item)))}>
            <Svg width={24} height={24} viewBox="0 0 24 24"><Path fill="#fff" d="M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4m0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4m0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4" /></Svg>
          </Pressable>
        </View>
      </View>
      <View pointerEvents="none" style={styles.track}><View style={[styles.progress, { width: `${progress * 100}%` }]} /></View>
    </View> : null}
    {speedSheet ? <TvChoiceSheet title={t("playbackSpeed")} t={t} value={String(Math.round(rate * 100) / 100)}
      options={speedOptions(rate).map((value) => ({ value, label: speedLabel(value) }))}
      onSelect={chooseSpeed} onClose={() => setSpeedSheet(false)} /> : null}
  </View>;
}

/** One page: the Short's portrait thumbnail, with its player over it once loaded. A tap pauses or plays. */
const ShortPage = memo(function ShortPage({ height, player, thumbnail, onPress }: {
  height: number; player: VideoPlayer | null; thumbnail: ShortSources; onPress: () => void;
}) {
  return <Pressable onPress={onPress} style={{ height }}>
    <ShortThumbnail sources={thumbnail} fit="contain" style={StyleSheet.absoluteFill} />
    {player ? <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} contentFit="contain"
      surfaceType="textureView" allowsPictureInPicture={false} /> : null}
  </Pressable>;
});

const styles = StyleSheet.create({
  screen: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "#000" },
  hidden: { opacity: 0 },
  back: { position: "absolute", left: 14, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backGlyph: { color: "#fff", fontSize: 38, lineHeight: 40, marginTop: -4 },
  center: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  playCircle: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)" },
  error: { ...phoneType.body, color: phoneColors.text, textAlign: "center", padding: 24 },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 14, gap: 12 },
  copy: { flex: 1, gap: 10 },
  channel: { flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "flex-start" },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: phoneColors.surface },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  letter: { color: "#fff", fontSize: 15, fontWeight: "700" },
  channelName: { ...phoneType.title, color: "#fff", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  title: { ...phoneType.body, color: "#fff", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  side: { gap: 14, alignItems: "center" },
  sideButton: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)" },
  sideText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  track: { position: "absolute", left: 0, right: 0, bottom: 0, height: 2, backgroundColor: "rgba(255,255,255,0.3)" },
  progress: { height: 2, backgroundColor: "#fff" },
});
