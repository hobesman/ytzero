import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { VideoPlayer } from "expo-video";
import { FullscreenGestures, gestureTuning, type GestureEvent, type LevelTarget, type SeekSide } from "../fullscreenGestures";
import type { Translate } from "../i18n";
import { seekPlayer } from "../playerControl";
import { playerLevels } from "../playerLevels";

type Feedback = { kind: "level"; target: LevelTarget; value: number } | { kind: "seek"; side: SeekSide; seconds: number } | null;

type TouchHandlers = {
  onLayout: (event: LayoutChangeEvent) => void;
  onTouchStart: (event: GestureResponderEvent) => void;
  onTouchMove: (event: GestureResponderEvent) => void;
  onTouchEnd: (event: GestureResponderEvent) => void;
  onTouchCancel: () => void;
};

/**
 * The fullscreen player's swipes and taps (see fullscreenGestures.ts): touch handlers for the
 * view around the video, and the overlay that shows the level or the jump while it happens.
 * `onTap` gets the taps that aren't seeking. Brightness goes back to the system's when
 * `enabled` turns off.
 */
export function useFullscreenGestures({ enabled, player, t, onTap }: {
  enabled: boolean; player: VideoPlayer | null; t: Translate; onTap: () => void;
}): { handlers: TouchHandlers; overlay: ReactNode } {
  const recognizer = useMemo(() => new FullscreenGestures(playerLevels), []);
  const size = useRef({ width: 0, height: 0 });
  const [feedback, setFeedback] = useState<Feedback>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const brightnessChanged = useRef(false);
  const latest = useRef({ player, onTap });
  latest.current = { player, onTap };

  useEffect(() => {
    if (enabled) return;
    recognizer.cancel();
    setFeedback(null);
    if (brightnessChanged.current) { brightnessChanged.current = false; playerLevels?.resetBrightness(); }
  }, [enabled, recognizer]);
  useEffect(() => () => {
    clearTimeout(hideTimer.current);
    if (brightnessChanged.current) playerLevels?.resetBrightness();
  }, []);

  const hideSoon = (ms: number) => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setFeedback(null), ms);
  };
  const handle = (event: GestureEvent | null) => {
    if (!event) return;
    if (event.kind === "tap") { latest.current.onTap(); return; }
    if (event.kind === "levelEnd") { hideSoon(600); return; }
    if (event.kind === "level") {
      clearTimeout(hideTimer.current);
      if (event.target === "brightness") { brightnessChanged.current = true; playerLevels?.setBrightness(event.value); }
      else playerLevels?.setVolume(event.value);
      setFeedback(event);
      return;
    }
    const current = latest.current.player;
    if (!current) return;
    const step = (event.side === "back" ? -1 : 1) * gestureTuning.jumpSeconds;
    const end = current.duration > 0 ? current.duration - 1 : Infinity;
    void seekPlayer(current, Math.max(0, Math.min(end, current.currentTime + step))).catch(() => {});
    setFeedback({ kind: "seek", side: event.side, seconds: event.jumps * gestureTuning.jumpSeconds });
    hideSoon(gestureTuning.nextGapMs + 150);
  };

  const handlers: TouchHandlers = {
    onLayout: ({ nativeEvent }) => { size.current = { width: nativeEvent.layout.width, height: nativeEvent.layout.height }; },
    // locationX/Y: the video view fills this one, so its coordinates are this view's.
    onTouchStart: ({ nativeEvent }) => {
      if (nativeEvent.touches.length > 1) { handle(recognizer.cancel()); return; }
      recognizer.start(nativeEvent.locationX, nativeEvent.locationY, Date.now(), size.current.width, size.current.height);
    },
    onTouchMove: ({ nativeEvent }) => {
      if (nativeEvent.touches.length > 1) { handle(recognizer.cancel()); return; }
      handle(recognizer.move(nativeEvent.locationX, nativeEvent.locationY));
    },
    onTouchEnd: ({ nativeEvent }) => handle(recognizer.end(nativeEvent.locationX, nativeEvent.locationY, Date.now())),
    onTouchCancel: () => handle(recognizer.cancel()),
  };

  const overlay = feedback ? <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {feedback.kind === "level" ? <LevelMeter target={feedback.target} value={feedback.value} t={t} />
      : <SeekBubble side={feedback.side} seconds={feedback.seconds} t={t} />}
  </View> : null;
  return { handlers, overlay };
}

const sun = "M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z M12 2v2 M12 20v2 M4.93 4.93l1.41 1.41 M17.66 17.66l1.41 1.41 M2 12h2 M20 12h2 M4.93 19.07l1.41-1.41 M17.66 6.34l1.41-1.41";
const speaker = "M11 5 6 9H2v6h4l5 4z";
const waves = "M15.5 8.5a5 5 0 0 1 0 7 M19 5a10 10 0 0 1 0 14";
const muted = "M22 9l-6 6 M16 9l6 6";

function LevelMeter({ target, value, t }: { target: LevelTarget; value: number; t: Translate }) {
  const percent = Math.round(value * 100);
  const label = t(target === "brightness" ? "playerBrightness" : "playerVolume");
  return <View style={[styles.levelSlot, target === "brightness" ? styles.left : styles.right]}>
    <View accessibilityLiveRegion="polite" accessibilityLabel={`${label} ${percent}%`} style={styles.meter}>
      <Svg width={26} height={26} viewBox="0 0 24 24">
        <Path d={target === "brightness" ? sun : `${speaker} ${percent === 0 ? muted : waves}`} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      <View style={styles.track}><View style={[styles.fill, { height: `${percent}%` }]} /></View>
      <Text style={styles.meterText}>{percent}%</Text>
    </View>
  </View>;
}

function SeekBubble({ side, seconds, t }: { side: SeekSide; seconds: number; t: Translate }) {
  const text = t(side === "back" ? "seekBackSeconds" : "seekForwardSeconds").replace("{seconds}", String(seconds));
  return <View style={[styles.seekSlot, side === "back" ? styles.seekLeft : styles.seekRight]}>
    <View accessibilityLiveRegion="polite" accessibilityLabel={text} style={styles.bubble}>
      <Svg width={28} height={28} viewBox="0 0 24 24">
        <Path d={side === "back" ? "M11 17l-5-5 5-5 M18 17l-5-5 5-5" : "M13 17l5-5-5-5 M6 17l5-5-5-5"} fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      <Text style={styles.bubbleText}>{text}</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  levelSlot: { position: "absolute", top: 0, bottom: 0, justifyContent: "center" },
  left: { left: 48 },
  right: { right: 48 },
  meter: { alignItems: "center", gap: 10, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 26, backgroundColor: "rgba(0,0,0,0.6)" },
  track: { width: 6, height: 140, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.3)", justifyContent: "flex-end", overflow: "hidden" },
  fill: { width: "100%", backgroundColor: "#fff" },
  meterText: { color: "#fff", fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  seekSlot: { position: "absolute", top: 0, bottom: 0, width: "35%", alignItems: "center", justifyContent: "center" },
  seekLeft: { left: 0 },
  seekRight: { right: 0 },
  bubble: { alignItems: "center", gap: 4, paddingVertical: 14, paddingHorizontal: 22, borderRadius: 40, backgroundColor: "rgba(0,0,0,0.55)" },
  bubbleText: { color: "#fff", fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
