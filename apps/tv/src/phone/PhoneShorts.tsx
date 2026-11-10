import { createContext, memo, useCallback, useContext, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType, type ImageStyle, type StyleProp } from "react-native";
import type { YtZeroApi } from "../api";
import { isShort, shortsFrom, type OpenShorts } from "../shortsSession";
import type { Video } from "../types";
import { phoneColors, phoneType } from "./phoneTheme";

/** Opens the vertical Shorts player; provided by the app in the phone layout. */
export const PhoneShortsContext = createContext<OpenShorts | null>(null);

/**
 * A screen's tap handler for Shorts: a Short opens the Shorts player with the
 * screen's other Shorts a swipe away, and reports true. Anything else is left
 * to the screen's usual handler.
 */
export function useOpenShort() {
  const openShorts = useContext(PhoneShortsContext);
  return useCallback((list: Video[], video: Video, loadMore?: () => Promise<Video[]>): boolean => {
    if (!openShorts || !isShort(video)) return false;
    const { items, index } = shortsFrom(list, video);
    openShorts(items, index, loadMore);
    return true;
  }, [openShorts]);
}

export const shortsGridColumns = 3;

export type ShortSources = { portrait: ImageSourcePropType; fallback: ImageSourcePropType | null };

/** Stable portrait thumbnails for Shorts, falling back to the video's own thumbnail when YouTube has none. */
export function useShortThumbnail(api: YtZeroApi) {
  const sources = useRef(new Map<string, ShortSources>());
  return useCallback((video: Video) => {
    let cached = sources.current.get(video.video_id);
    if (!cached) {
      cached = { portrait: api.shortThumbnailSource(video.video_id) as ImageSourcePropType, fallback: video.thumbnail ? api.thumbnailSource(video.thumbnail) as ImageSourcePropType : null };
      sources.current.set(video.video_id, cached);
    }
    return cached;
  }, [api]);
}

/** A Short's portrait thumbnail, or its regular one when the portrait one fails to load. */
export function ShortThumbnail({ sources, style, fit = "cover" }: { sources: ShortSources; style: StyleProp<ImageStyle>; fit?: "cover" | "contain" }) {
  const [failed, setFailed] = useState(false);
  return <Image source={failed && sources.fallback ? sources.fallback : sources.portrait} style={style} resizeMode={fit} onError={() => setFailed(true)} />;
}

/** A Short in a three-column grid: its portrait thumbnail with the title over it. */
export const PhoneShortCard = memo(function PhoneShortCard({ video, thumbnail, onPress, onLongPress }: {
  video: Video; thumbnail: ShortSources; onPress: (video: Video) => void; onLongPress?: (video: Video) => void;
}) {
  const progress = video.watch_position && video.watch_duration ? Math.max(0, Math.min(1, video.watch_position / video.watch_duration)) : 0;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${video.title}. ${video.channel_title}`}
    onPress={() => onPress(video)} onLongPress={onLongPress ? () => onLongPress(video) : undefined}
    style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
    <ShortThumbnail sources={thumbnail} style={styles.thumbnail} />
    <View pointerEvents="none" style={styles.shade}>
      <Text numberOfLines={2} style={styles.title}>{video.title}</Text>
    </View>
    {progress > 0 ? <View style={styles.track}><View style={[styles.progress, { width: `${progress * 100}%` }]} /></View> : null}
  </Pressable>;
});

/** Keeps a short last row from stretching its cards. */
export const shortsGridStyles = StyleSheet.create({
  content: { paddingHorizontal: 2 },
  row: { gap: 2, paddingBottom: 2 },
});

const styles = StyleSheet.create({
  card: { flex: 1 / shortsGridColumns, aspectRatio: 9 / 16, backgroundColor: phoneColors.surface, overflow: "hidden" },
  pressed: { opacity: 0.7 },
  thumbnail: { width: "100%", height: "100%" },
  shade: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 8, paddingTop: 24, backgroundColor: "rgba(0,0,0,0.35)" },
  title: { ...phoneType.caption, color: "#fff", fontWeight: "600" },
  track: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3, backgroundColor: "rgba(255,255,255,0.3)" },
  progress: { height: 3, backgroundColor: phoneColors.accent },
});
