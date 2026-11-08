import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import type { YtZeroApi } from "../api";
import { formatBookmarkTime } from "../bookmarkTime";
import type { Translate } from "../i18n";
import { sessionContext, type OpenVideo } from "../playbackQueue";
import type { BookmarkVideo, Video } from "../types";
import { PhoneChip } from "./PhoneChip";
import { phoneColors, phoneType } from "./phoneTheme";
import { useImageSource } from "./useImageSource";

/** Saved moments: each opens its video at the bookmarked time. */
export function PhoneBookmarksScreen({ api, t, videoUpdate, onOpen }: { api: YtZeroApi; t: Translate; videoUpdate: Video | null; onOpen: OpenVideo }) {
  const [bookmarks, setBookmarks] = useState<BookmarkVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const source = useImageSource(api);
  const load = useCallback(async (refresh = false) => {
    const id = ++request.current;
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(false);
    try {
      const result = await api.bookmarks();
      if (id === request.current) setBookmarks(result.bookmarks);
    } catch { if (id === request.current) setError(true); }
    finally { if (id === request.current) { setLoading(false); setRefreshing(false); } }
  }, [api]);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);
  useEffect(() => {
    if (videoUpdate) setBookmarks((current) => current.map((item) => item.video_id === videoUpdate.video_id ? { ...item, ...videoUpdate } : item));
  }, [videoUpdate]);
  const open = (bookmark: BookmarkVideo) => onOpen(bookmark, sessionContext(bookmarks), true, bookmark.position_seconds);

  if (loading) return <View style={styles.center}><ActivityIndicator color={phoneColors.text} size="large" accessibilityLabel={t("loadingBookmarks")} /></View>;
  return <FlatList data={bookmarks} keyExtractor={(item) => item.bookmark_id}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={phoneColors.text} colors={[phoneColors.accent]} progressBackgroundColor={phoneColors.surface} />}
    renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}, ${formatBookmarkTime(item.position_seconds)}`}
      onPress={() => open(item)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.thumbnail}>
        {item.thumbnail ? <Image source={source(item.thumbnail)!} style={styles.fill} resizeMode="cover" /> : null}
        <View style={styles.time}><Text style={styles.timeText}>{formatBookmarkTime(item.position_seconds)}</Text></View>
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={2} style={styles.title}>{item.title}</Text>
        {item.bookmark_description ? <Text numberOfLines={2} style={styles.description}>{item.bookmark_description}</Text> : null}
        <Text numberOfLines={1} style={styles.meta}>{item.channel_title}</Text>
      </View>
    </Pressable>}
    ListEmptyComponent={<View style={styles.center}>
      <Text style={styles.emptyTitle}>{error ? t("bookmarksLoadError") : t("bookmarksEmpty")}</Text>
      {error ? <PhoneChip label={t("tryAgain")} onPress={() => void load()} /> : <Text style={styles.meta}>{t("bookmarksEmptyHint")}</Text>}
    </View>} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 32 },
  row: { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  pressed: { backgroundColor: "rgba(255,255,255,0.06)" },
  thumbnail: { width: 160, aspectRatio: 16 / 9, borderRadius: 8, overflow: "hidden", backgroundColor: phoneColors.surface },
  fill: { width: "100%", height: "100%" },
  time: { position: "absolute", right: 5, bottom: 5, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, backgroundColor: "rgba(0,0,0,0.8)" },
  timeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  copy: { flex: 1, gap: 3 },
  title: { ...phoneType.title, color: phoneColors.text },
  description: { ...phoneType.caption, color: phoneColors.text },
  meta: { ...phoneType.caption, color: phoneColors.textMuted, textAlign: "center" },
  emptyTitle: { ...phoneType.title, color: phoneColors.text, textAlign: "center" },
});
