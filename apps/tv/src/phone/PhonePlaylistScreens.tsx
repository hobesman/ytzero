import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import type { YtZeroApi } from "../api";
import type { Translate } from "../i18n";
import { normalizePlaylistSort, playlistContinueTarget, playlistQueue, playlistVideos, type PlaylistSort } from "../playlist";
import type { OpenVideo } from "../playbackQueue";
import type { FollowedPlaylist, Language, Video } from "../types";
import { PhoneChip } from "./PhoneChip";
import { PhoneVideoCard } from "./PhoneVideoCard";
import { phoneColors, phoneType } from "./phoneTheme";
import { useImageSource } from "./useImageSource";

/** Followed playlists as rows; a tap opens the playlist. */
export function PhoneFollowedPlaylistsScreen({ api, t, onOpenPlaylist }: { api: YtZeroApi; t: Translate; onOpenPlaylist: (playlist: FollowedPlaylist) => void }) {
  const [playlists, setPlaylists] = useState<FollowedPlaylist[]>([]);
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
      const result = await api.followedPlaylists();
      if (id === request.current) setPlaylists(result.playlists);
    } catch { if (id === request.current) setError(true); }
    finally { if (id === request.current) { setLoading(false); setRefreshing(false); } }
  }, [api]);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={phoneColors.text} size="large" accessibilityLabel={t("loadingPlaylists")} /></View>;
  return <FlatList data={playlists} keyExtractor={(item) => item.playlist_id}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={phoneColors.text} colors={[phoneColors.accent]} progressBackgroundColor={phoneColors.surface} />}
    renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={item.title} onPress={() => onOpenPlaylist(item)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.thumbnail}>{item.thumbnail ? <Image source={source(item.thumbnail)!} style={styles.fill} resizeMode="cover" /> : null}</View>
      <View style={styles.copy}>
        <Text numberOfLines={2} style={styles.title}>{item.title}</Text>
        <Text numberOfLines={1} style={styles.meta}>{item.channel_title}</Text>
        <Text numberOfLines={1} style={styles.meta}>{`${item.video_count} ${t("videos")}`}</Text>
      </View>
    </Pressable>}
    ListEmptyComponent={<View style={styles.center}>
      <Text style={styles.emptyText}>{error ? t("playlistsLoadError") : t("tvEmptyFollowedPlaylistsEmptyDescription")}</Text>
      {error ? <PhoneChip label={t("tryAgain")} onPress={() => void load()} /> : null}
    </View>} />;
}

/** One playlist: Continue or Play all, then its videos in the playlist's chosen order. */
export function PhonePlaylistScreen({ api, playlistId, language, t, videoUpdate, onOpen, onVideoLongPress }: {
  api: YtZeroApi; playlistId: string; language: Language; t: Translate; videoUpdate: Video | null; onOpen: OpenVideo;
  onVideoLongPress: (video: Video, onChange: (updated: Video) => void) => void;
}) {
  const [page, setPage] = useState<{ playlist: FollowedPlaylist; videos: Video[]; sort: PlaylistSort } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const source = useImageSource(api);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setError(false);
    try {
      const [details, contents] = await Promise.all([api.channelPlaylist(playlistId), api.channelPlaylistVideos(playlistId)]);
      if (id === request.current) setPage({ playlist: details.playlist, videos: playlistVideos(contents), sort: normalizePlaylistSort(contents.sort) });
    } catch { if (id === request.current) setError(true); }
    finally { if (id === request.current) setLoading(false); }
  }, [api, playlistId]);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);
  useEffect(() => {
    if (videoUpdate) setPage((current) => current ? { ...current, videos: current.videos.map((item) => item.video_id === videoUpdate.video_id ? { ...item, ...videoUpdate } : item) } : current);
  }, [videoUpdate]);
  const context = useMemo(() => playlistQueue(playlistId, page?.sort ?? "oldest"), [page?.sort, playlistId]);
  const open = useCallback((video: Video) => onOpen(video, context), [context, onOpen]);
  const longPress = useCallback((video: Video) => onVideoLongPress(video, (updated) => setPage((current) => current
    ? { ...current, videos: current.videos.map((item) => item.video_id === updated.video_id ? updated : item) } : current)), [onVideoLongPress]);

  if (loading && !page) return <View style={styles.center}><ActivityIndicator color={phoneColors.text} size="large" accessibilityLabel={t("loadingPlaylists")} /></View>;
  if (error || !page) return <View style={styles.center}>
    <Text style={styles.emptyText}>{t("playlistsLoadError")}</Text>
    <PhoneChip label={t("tryAgain")} onPress={() => void load()} />
  </View>;
  const next = playlistContinueTarget(page.videos);
  const first = page.videos[0];
  return <FlatList data={page.videos} keyExtractor={(item) => item.video_id}
    refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={phoneColors.text} colors={[phoneColors.accent]} progressBackgroundColor={phoneColors.surface} />}
    ListHeaderComponent={<View style={styles.header}>
      <Text style={styles.heading}>{page.playlist.title}</Text>
      <Text style={styles.meta}>{[page.playlist.channel_title, `${page.videos.length} ${t("videos")}`].filter(Boolean).join(" · ")}</Text>
      <View style={styles.actions}>
        {next ? <PhoneChip primary label={t("continueWatching")} onPress={() => onOpen(next, context, true)} /> : null}
        {first ? <PhoneChip primary={!next} label={t("playlistPlayAll")} onPress={() => onOpen(first, context, true, 0)} /> : null}
      </View>
    </View>}
    renderItem={({ item }) => <PhoneVideoCard video={item} language={language} t={t} onPress={open} onLongPress={longPress}
      thumbnail={source(item.thumbnail)!} channelAvatar={source(item.channel_thumbnail)} />}
    ListEmptyComponent={<Text style={[styles.emptyText, styles.padded]}>{t("playlistVideosEmpty")}</Text>}
    initialNumToRender={4} maxToRenderPerBatch={4} windowSize={7} removeClippedSubviews />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 32 },
  row: { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  pressed: { backgroundColor: "rgba(255,255,255,0.06)" },
  thumbnail: { width: 160, aspectRatio: 16 / 9, borderRadius: 8, overflow: "hidden", backgroundColor: phoneColors.surface },
  fill: { width: "100%", height: "100%" },
  copy: { flex: 1, gap: 3 },
  title: { ...phoneType.title, color: phoneColors.text },
  meta: { ...phoneType.caption, color: phoneColors.textMuted },
  header: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 16, gap: 6 },
  heading: { ...phoneType.heading, color: phoneColors.text },
  actions: { flexDirection: "row", gap: 8, paddingTop: 8 },
  emptyText: { ...phoneType.body, color: phoneColors.textMuted, textAlign: "center" },
  padded: { padding: 24 },
});
