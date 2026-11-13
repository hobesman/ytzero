import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { TvChoiceSheet } from "../components/TvChoiceSheet";
import type { Translate } from "../i18n";
import { musicPlayer } from "../musicPlayer";
import { phoneColors, phoneType } from "../phone/phoneTheme";
import { onSleepTimerChange, setSleepTimer, sleepCountdownLabel, sleepTimer, sleepTimerChoice, sleepTimerRemaining, SLEEP_TIMER_CHOICES, type SleepTimerChoice } from "../sleepTimer";
import type { MusicApi } from "./musicApi";
import { MusicIcon } from "./MusicIcon";
import { current, upNext } from "./musicQueue";
import type { MusicSession, MusicSessionState } from "./musicSession";
import { durationLabel, MusicArtwork, MusicTrackRow } from "./MusicTrackRow";

/** The playing song's position, read from the player every second while shown. */
function usePosition(state: MusicSessionState, active: boolean) {
  const [position, setPosition] = useState(state.player?.position ?? 0);
  useEffect(() => {
    setPosition(state.player?.position ?? 0);
    if (!active) return;
    const read = () => { void musicPlayer.getState().then((player) => { if (player) setPosition(player.position); }); };
    read();
    const timer = setInterval(read, 1000);
    return () => clearInterval(timer);
  }, [active, state.player?.videoId, state.player?.playing, state.player?.position]);
  return position;
}

function useSleepTimerState() {
  const [timer, setTimer] = useState(sleepTimer);
  const [now, setNow] = useState(Date.now);
  useEffect(() => onSleepTimerChange(() => setTimer(sleepTimer())), []);
  useEffect(() => {
    if (timer.kind !== "time") return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [timer]);
  return { timer, remaining: sleepTimerRemaining(timer, now) };
}

function Control({ label, onPress, children, size = 48, primary }: { label: string; onPress: () => void; children: React.ReactNode; size?: number; primary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress}
    style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2 }, styles.control, primary && styles.primary, pressed && styles.pressed]}>
    {children}
  </Pressable>;
}

/** The bar above the tabs while a station plays; tapping it opens the player. */
export function MusicMiniBar({ api, session, state, t, onOpen }: { api: MusicApi; session: MusicSession; state: MusicSessionState; t: Translate; onOpen: () => void }) {
  const track = current(state.queue);
  const position = usePosition(state, true);
  if (!track && !state.starting) return null;
  const duration = state.player?.duration ?? track?.duration ?? 0;
  const playing = state.player?.playing ?? false;
  return <Pressable accessibilityRole="button" accessibilityLabel={t("musicNowPlaying")} onPress={onOpen} style={styles.mini}>
    <View style={[styles.miniProgress, { width: `${duration ? Math.min(100, (position / duration) * 100) : 0}%` }]} />
    {track ? <MusicArtwork api={api} url={track.thumbnail} size={40} radius={4} /> : <ActivityIndicator color={phoneColors.text} />}
    <View style={styles.miniCopy}>
      <Text numberOfLines={1} style={styles.miniTitle}>{track?.title ?? t("musicStarting")}</Text>
      {track ? <Text numberOfLines={1} style={styles.miniArtist}>{track.artist}</Text> : null}
    </View>
    {track ? <>
      <Control size={40} label={playing ? t("musicPause") : t("musicPlay")} onPress={() => session.togglePlay()}>
        {state.player?.buffering && !playing ? <ActivityIndicator color={phoneColors.text} /> : <MusicIcon name={playing ? "pause" : "play"} color={phoneColors.text} size={22} />}
      </Control>
      <Control size={40} label={t("musicNext")} onPress={() => session.next()}><MusicIcon name="next" color={phoneColors.text} size={20} /></Control>
    </> : null}
  </Pressable>;
}

/** The full player: artwork, progress, controls, like / not this one, and what plays next. */
export function MusicNowPlaying({ api, session, state, t, onClose }: { api: MusicApi; session: MusicSession; state: MusicSessionState; t: Translate; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const [sleepSheet, setSleepSheet] = useState(false);
  const [barWidth, setBarWidth] = useState(1);
  const sleep = useSleepTimerState();
  const track = current(state.queue);
  const position = usePosition(state, true);
  const next = upNext(state.queue);
  if (!track) return null;
  const duration = state.player?.duration ?? track.duration ?? 0;
  const playing = state.player?.playing ?? false;
  const liked = track.rating === 1;
  const art = Math.min(width - 64, height * 0.38);
  const sleepLabel = sleep.remaining !== null ? sleepCountdownLabel(sleep.remaining) : sleep.timer.kind === "end" ? t("musicSleepEndOfSong") : null;
  const header = <View style={styles.player}>
    <MusicArtwork api={api} url={track.thumbnail} size={art} radius={12} />
    <View style={styles.copy}>
      <Text numberOfLines={2} style={styles.title}>{track.title}</Text>
      <Text numberOfLines={1} style={styles.artist}>{[track.artist, track.album].filter(Boolean).join(" · ")}</Text>
    </View>
    <Pressable accessibilityRole="adjustable" accessibilityLabel={`${durationLabel(position)} / ${durationLabel(duration)}`} style={styles.bar}
      onLayout={(event) => setBarWidth(Math.max(1, event.nativeEvent.layout.width))}
      onPress={(event) => { if (duration) session.seekTo((event.nativeEvent.locationX / barWidth) * duration); }}>
      <View style={styles.track}><View style={[styles.fill, { width: `${duration ? Math.min(100, (position / duration) * 100) : 0}%` }]} /></View>
    </Pressable>
    <View style={styles.times}>
      <Text style={styles.time}>{durationLabel(position) || "0:00"}</Text>
      <Text style={styles.time}>{durationLabel(duration)}</Text>
    </View>
    <View style={styles.controls}>
      <Control label={t("musicNotThis")} onPress={() => void session.dislike(track)}><MusicIcon name="dislike" color={phoneColors.text} /></Control>
      <Control label={t("musicPrevious")} onPress={() => session.previous()}><MusicIcon name="previous" color={phoneColors.text} size={28} /></Control>
      <Control primary size={68} label={playing ? t("musicPause") : t("musicPlay")} onPress={() => session.togglePlay()}>
        {state.player?.buffering && !playing ? <ActivityIndicator color={phoneColors.background} /> : <MusicIcon name={playing ? "pause" : "play"} color={phoneColors.background} size={32} />}
      </Control>
      <Control label={t("musicNext")} onPress={() => session.next()}><MusicIcon name="next" color={phoneColors.text} size={28} /></Control>
      <Control label={liked ? t("musicUnlike") : t("musicLike")} onPress={() => void session.like(track, !liked)}>
        <MusicIcon name={liked ? "liked" : "like"} color={liked ? phoneColors.accent : phoneColors.text} />
      </Control>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${t("sleepTimer")}: ${sleepLabel ?? t("sleepTimerOff")}`} onPress={() => setSleepSheet(true)} style={styles.sleep}>
      <MusicIcon name="sleep" color={sleepLabel ? phoneColors.accent : phoneColors.textMuted} size={18} />
      <Text style={[styles.sleepLabel, sleepLabel ? styles.sleepOn : null]}>{sleepLabel ?? t("sleepTimer")}</Text>
    </Pressable>
    {next.length ? <Text style={styles.section}>{t("musicUpNext")}</Text> : null}
  </View>;
  // The app root already keeps clear of the system bars.
  return <View style={styles.screen}>
    <View style={styles.top}>
      <Pressable hitSlop={12} accessibilityRole="button" accessibilityLabel={t("close")} onPress={onClose}><MusicIcon name="down" color={phoneColors.text} size={28} /></Pressable>
      <Text style={styles.heading}>{t("musicNowPlaying")}</Text>
      <View style={styles.topSpacer} />
    </View>
    <FlatList data={next} keyExtractor={(entry) => entry.videoId} ListHeaderComponent={header} contentContainerStyle={styles.list}
      renderItem={({ item }) => <MusicTrackRow api={api} track={item} onPress={(entry) => session.skipTo(entry.videoId)} onLongPress={(entry) => void session.dislike(entry)} />} />
    {sleepSheet ? <TvChoiceSheet<SleepTimerChoice> title={t("sleepTimer")} t={t} value={sleepTimerChoice(sleep.timer)}
      options={SLEEP_TIMER_CHOICES.map((value) => ({ value, label: value === "off" ? t("sleepTimerOff") : value === "end" ? t("musicSleepEndOfSong") : t("sleepTimerMinutes").replace("{count}", value) }))}
      onSelect={(value) => { setSleepTimer(value); setSleepSheet(false); }} onClose={() => setSleepSheet(false)} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  control: { alignItems: "center", justifyContent: "center" },
  primary: { backgroundColor: phoneColors.text },
  pressed: { opacity: 0.6 },
  mini: { height: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, backgroundColor: phoneColors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: phoneColors.divider },
  miniProgress: { position: "absolute", top: 0, left: 0, height: 2, backgroundColor: phoneColors.accent },
  miniCopy: { flex: 1, gap: 1 },
  miniTitle: { ...phoneType.title, color: phoneColors.text },
  miniArtist: { ...phoneType.caption, color: phoneColors.textMuted },
  screen: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: phoneColors.background },
  top: { height: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  heading: { ...phoneType.title, color: phoneColors.text },
  topSpacer: { width: 28 },
  list: { paddingBottom: 16 },
  player: { alignItems: "center", paddingHorizontal: 24, paddingTop: 8 },
  copy: { alignSelf: "stretch", gap: 4, marginTop: 24 },
  title: { ...phoneType.heading, color: phoneColors.text },
  artist: { ...phoneType.body, fontSize: 15, color: phoneColors.textMuted },
  bar: { alignSelf: "stretch", paddingVertical: 12, marginTop: 12 },
  track: { height: 4, borderRadius: 2, backgroundColor: phoneColors.surfaceRaised, overflow: "hidden" },
  fill: { height: 4, backgroundColor: phoneColors.text },
  times: { alignSelf: "stretch", flexDirection: "row", justifyContent: "space-between" },
  time: { ...phoneType.caption, color: phoneColors.textMuted },
  controls: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16 },
  sleep: { flexDirection: "row", alignItems: "center", gap: 6, padding: 10, marginTop: 12 },
  sleepLabel: { ...phoneType.caption, color: phoneColors.textMuted },
  sleepOn: { color: phoneColors.accent },
  section: { ...phoneType.caption, alignSelf: "stretch", fontWeight: "700", color: phoneColors.textMuted, textTransform: "uppercase", letterSpacing: 0.6, paddingTop: 24, paddingBottom: 6 },
});
