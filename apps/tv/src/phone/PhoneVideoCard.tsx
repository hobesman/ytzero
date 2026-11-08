import { memo, useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import { formatVideoDuration } from "../duration";
import type { Translate } from "../i18n";
import type { Language, Video } from "../types";
import { formatVideoCardMetadata } from "../videoMetadata";
import { phoneColors, phoneType } from "./phoneTheme";

type Props = {
  video: Video; language: Language; t: Translate; compact?: boolean;
  thumbnail: ImageSourcePropType; channelAvatar: ImageSourcePropType | null;
  onPress: (video: Video) => void;
  /** A long press opens the video's actions. */
  onLongPress?: (video: Video) => void;
};

/** A phone feed card: full-width thumbnail, then channel avatar, title and details. */
export const PhoneVideoCard = memo(function PhoneVideoCard({ video, language, t, compact = false, thumbnail, channelAvatar, onPress, onLongPress }: Props) {
  const metadata = useMemo(() => formatVideoCardMetadata(video, language, t("views")), [language, t, video]);
  const duration = useMemo(() => formatVideoDuration(video.duration), [video.duration]);
  const progress = video.watch_position && video.watch_duration ? Math.max(0, Math.min(1, video.watch_position / video.watch_duration)) : 0;
  const live = video.live_status === "live";
  return <Pressable accessibilityRole="button" accessibilityLabel={`${video.title}. ${video.channel_title}`}
    onPress={() => onPress(video)} onLongPress={onLongPress ? () => onLongPress(video) : undefined} style={({ pressed }) => [compact ? styles.compact : styles.card, pressed && styles.pressed]}>
    <View style={[styles.thumbnailFrame, compact && styles.compactThumbnail]}>
      <Image source={thumbnail} style={styles.thumbnail} resizeMode="cover" />
      {live ? <View style={[styles.badge, styles.live]}><Text style={styles.badgeText}>{t("liveBadge")}</Text></View>
        : duration ? <View style={styles.badge}><Text style={styles.badgeText}>{duration}</Text></View> : null}
      {progress > 0 ? <View style={styles.progressTrack}><View style={[styles.progress, { width: `${progress * 100}%` }]} /></View> : null}
    </View>
    <View style={[styles.copy, compact && styles.compactCopy]}>
      {!compact ? channelAvatar ? <Image source={channelAvatar} style={styles.avatar} />
        : <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarLetter}>{(video.channel_title ?? "?").slice(0, 1)}</Text></View> : null}
      <View style={styles.text}>
        <Text numberOfLines={2} style={compact ? styles.compactTitle : styles.title}>{video.title}</Text>
        <Text numberOfLines={1} style={styles.meta}>{[video.channel_title, metadata].filter(Boolean).join(" · ")}</Text>
      </View>
    </View>
  </Pressable>;
});

const styles = StyleSheet.create({
  card: { paddingBottom: 18 },
  compact: { width: 220 },
  pressed: { opacity: 0.7 },
  thumbnailFrame: { width: "100%", aspectRatio: 16 / 9, backgroundColor: phoneColors.surface, overflow: "hidden" },
  compactThumbnail: { borderRadius: 10 },
  thumbnail: { width: "100%", height: "100%" },
  badge: { position: "absolute", right: 6, bottom: 6, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, backgroundColor: "rgba(0,0,0,0.8)" },
  live: { backgroundColor: "#cc0000" },
  badgeText: { color: phoneColors.text, fontSize: 12, fontWeight: "600" },
  progressTrack: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3, backgroundColor: "rgba(255,255,255,0.3)" },
  progress: { height: 3, backgroundColor: "#ff0033" },
  copy: { flexDirection: "row", gap: 12, paddingHorizontal: 12, paddingTop: 10 },
  compactCopy: { paddingHorizontal: 0, paddingTop: 8 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: phoneColors.surface },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarLetter: { color: phoneColors.text, fontSize: 15, fontWeight: "700" },
  text: { flex: 1, gap: 3 },
  title: { ...phoneType.title, color: phoneColors.text },
  compactTitle: { ...phoneType.body, fontWeight: "600", color: phoneColors.text },
  meta: { ...phoneType.caption, color: phoneColors.textMuted },
});
