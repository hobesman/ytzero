import { useEvent } from "expo";
import { VideoView, type VideoPlayer } from "expo-video";
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import type { Translate } from "../i18n";
import { colors } from "../theme";
import { leavesIntoPictureInPicture } from "../pictureInPicture";
import { useMiniPlayerBottom } from "./MiniPlayerHost";
import { useMiniPlayerDrag } from "./useMiniPlayerDrag";

const barHeight = 40;

/** The minimized phone player: tap to expand, with play/pause and close; drag it out of the way. */
export function TvMiniPlayer({ player, title, t, onExpand, onClose }: {
  player: VideoPlayer; title: string; t: Translate; onExpand: () => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reserved = useMiniPlayerBottom();
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const frameWidth = height > width ? width * 0.56 : Math.min(320, width * 0.36);
  const bottom = Math.max(reserved, insets.bottom) + 12;
  const frameHeight = frameWidth * 9 / 16 + barHeight;
  const drag = useMiniPlayerDrag({
    maxLeft: width - frameWidth - insets.left - insets.right - 24,
    maxUp: height - frameHeight - bottom - insets.top - 12,
  });
  return <Animated.View {...drag.handlers}
    style={[styles.frame, { right: insets.right + 12, bottom, width: frameWidth, transform: drag.transform }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("miniPlayerExpand")} onPress={onExpand}>
      <View pointerEvents="none" style={{ width: frameWidth, height: frameWidth * 9 / 16 }}>
        <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} contentFit="contain" allowsPictureInPicture={false}
          startsPictureInPictureAutomatically={leavesIntoPictureInPicture && isPlaying} />
      </View>
    </Pressable>
    <View style={styles.bar}>
      <Pressable style={styles.titleButton} accessibilityRole="button" accessibilityLabel={t("miniPlayerExpand")} onPress={onExpand}>
        <Text numberOfLines={1} style={styles.title}>{title}</Text>
      </Pressable>
      <Pressable hitSlop={8} style={({ pressed }) => [styles.icon, pressed && styles.pressed]} accessibilityRole="button"
        accessibilityLabel={isPlaying ? t("miniPlayerPause") : t("miniPlayerPlay")}
        onPress={() => { if (isPlaying) player.pause(); else player.play(); }}>
        <Svg width={20} height={20} viewBox="0 0 24 24">
          <Path fill={colors.text} d={isPlaying ? "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" : "M8 5.5v13l10.5-6.5z"} />
        </Svg>
      </Pressable>
      <Pressable hitSlop={8} style={({ pressed }) => [styles.icon, pressed && styles.pressed]} accessibilityRole="button"
        accessibilityLabel={t("miniPlayerClose")} onPress={onClose}>
        <Svg width={20} height={20} viewBox="0 0 24 24">
          <Path stroke={colors.text} strokeWidth={2.4} strokeLinecap="round" d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
        </Svg>
      </Pressable>
    </View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  frame: { position: "absolute", zIndex: 1000, elevation: 12, borderRadius: 12, overflow: "hidden", backgroundColor: colors.black,
    shadowColor: colors.black, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  bar: { flexDirection: "row", alignItems: "center", paddingLeft: 10, paddingRight: 4, minHeight: barHeight, backgroundColor: colors.surface },
  titleButton: { flex: 1, paddingVertical: 8 },
  title: { color: colors.text, fontSize: 13, fontWeight: "600" },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  pressed: { backgroundColor: "rgba(255, 255, 255, 0.15)" },
});
