import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { Translate } from "../i18n";
import type { BufferedPlayback, PlaybackWait } from "../playbackBuffer";
import { colors } from "../theme";

/** A short stall, such as after a seek, passes without the overlay. */
const BUFFERING_DELAY_MS = 1000;
const idle: PlaybackWait = { waiting: "none", held: false };

function usePlaybackWait(entry: BufferedPlayback | null): PlaybackWait {
  const [state, setState] = useState<PlaybackWait>(idle);
  useEffect(() => {
    if (!entry) { setState(idle); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const next = entry.waitState();
      clearTimeout(timer);
      if (next.waiting === "buffering" && !next.held) timer = setTimeout(() => setState(entry.waitState()), BUFFERING_DELAY_MS);
      else setState(next);
    };
    update();
    const unsubscribe = entry.onWaitChange(update);
    return () => { clearTimeout(timer); unsubscribe(); };
  }, [entry]);
  return state;
}

/**
 * Over a video held up by the network. ExoPlayer's own play button does nothing
 * once its stream is lost, so this pause and play reach the reconnect too: paused,
 * it may still reconnect and buffer, but never starts playing by itself.
 */
export function PlaybackWaitOverlay({ entry, t }: { entry: BufferedPlayback | null; t: Translate }) {
  const { waiting, held } = usePlaybackWait(entry);
  // Playing, or paused and loaded again: ExoPlayer's own controls work.
  if (!entry || waiting === "none") return null;
  const caption = held ? t(waiting === "reconnecting" ? "playbackPausedOffline" : "playbackPaused")
    : t(waiting === "reconnecting" ? "playbackReconnecting" : "playbackBuffering");
  return <View pointerEvents="box-none" style={styles.overlay}>
    <Pressable accessibilityRole="button" accessibilityLabel={t(held ? "playVideo" : "pausePlayback")} hitSlop={12}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={() => held ? entry.resume() : entry.hold()}>
      {!held ? <ActivityIndicator style={StyleSheet.absoluteFill} color={colors.text} size="large" /> : null}
      <Svg width={28} height={28} viewBox="0 0 24 24">
        <Path fill={colors.text} d={held ? "M8 5.5v13l10.5-6.5z" : "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"} />
      </Svg>
    </Pressable>
    <View pointerEvents="none" style={styles.caption}><Text style={styles.captionText}>{caption}</Text></View>
  </View>;
}

const styles = StyleSheet.create({
  // The button sits exactly on ExoPlayer's centre button, which can't act here, and hides it.
  overlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  button: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0, 0, 0, 0.85)" },
  pressed: { backgroundColor: "rgba(60, 60, 60, 0.95)" },
  caption: { position: "absolute", top: "50%", marginTop: 52, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: "rgba(0, 0, 0, 0.6)" },
  captionText: { color: colors.text, fontSize: 14, lineHeight: 18, fontWeight: "600", textAlign: "center" },
});
