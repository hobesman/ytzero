import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import type { YtZeroApi } from "../api";
import { scheduledVideosInOrder, withoutInProgress } from "../feedSections";
import { browseEmptyState } from "../emptyState";
import type { Translate } from "../i18n";
import type { TvBrowseDestination } from "../navigation";
import { browseQueue, type OpenVideo } from "../playbackQueue";
import type { Language, Video } from "../types";
import { PhoneVideoCard } from "./PhoneVideoCard";
import { phoneColors, phoneType } from "./phoneTheme";

type Props = {
  api: YtZeroApi; destination: TvBrowseDestination; sort: "published" | "arrival";
  language: Language; t: Translate; onOpen: OpenVideo; header?: React.ReactNode; videoUpdate: Video | null;
  onVideoLongPress: (video: Video, onChange: (updated: Video) => void) => void;
};

/** Any browse destination as a phone list; Home adds Continue watching above its feed. */
export function PhoneFeedScreen({ api, destination, sort, language, t, onOpen, header, videoUpdate, onVideoLongPress }: Props) {
  const home = destination === "/";
  const [videos, setVideos] = useState<Video[]>([]);
  const [inProgress, setInProgress] = useState<Video[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(0);

  const load = useCallback(async (nextPage: number, refresh = false) => {
    const id = ++request.current;
    if (nextPage === 0) { if (refresh) setRefreshing(true); else setLoading(true); } else setLoadingMore(true);
    setError(false);
    try {
      const [result, progress] = await Promise.all([
        api.browse(destination, { page: nextPage, showAll: false, sort }),
        home && nextPage === 0 ? api.inProgress().then((value) => value.videos.filter((video) => video.is_short === 0)) : Promise.resolve(null),
      ]);
      if (id !== request.current) return;
      setVideos((previous) => nextPage === 0 ? result.videos : [...previous, ...result.videos]);
      if (progress) setInProgress(progress);
      setPage(result.page);
      setHasMore(result.hasMore);
    } catch {
      if (id === request.current) setError(true);
    } finally {
      if (id === request.current) { setLoading(false); setRefreshing(false); setLoadingMore(false); }
    }
  }, [api, destination, home, sort]);

  useEffect(() => { void load(0); return () => { request.current++; }; }, [load]);

  // Progress saved by the player shows on the card without a reload.
  useEffect(() => {
    if (!videoUpdate) return;
    const apply = (list: Video[]) => list.map((video) => video.video_id === videoUpdate.video_id ? { ...video, ...videoUpdate } : video);
    setVideos(apply);
    setInProgress(apply);
  }, [videoUpdate]);

  const feed = useMemo(() => home ? withoutInProgress(videos, inProgress)
    : destination === "/watchlist" ? scheduledVideosInOrder(videos) : videos, [destination, home, inProgress, videos]);
  const empty = browseEmptyState(destination, false, null, inProgress.length > 0);
  const queue = useMemo(() => browseQueue(destination, feed, sort), [destination, feed, sort]);
  const sources = useRef(new Map<string, ImageSourcePropType>());
  const source = useCallback((url: string | null | undefined): ImageSourcePropType | null => {
    if (!url) return null;
    let cached = sources.current.get(url);
    if (!cached) { cached = api.thumbnailSource(url) as ImageSourcePropType; sources.current.set(url, cached); }
    return cached;
  }, [api]);
  const open = useCallback((video: Video) => onOpen(video, queue), [onOpen, queue]);
  // An action that moves a video in or out of Rejected removes it from this list.
  const applyAction = useCallback((updated: Video) => {
    const keep = (destination === "/archive") === (updated.status === "archived");
    const apply = (list: Video[]) => keep ? list.map((video) => video.video_id === updated.video_id ? updated : video) : list.filter((video) => video.video_id !== updated.video_id);
    setVideos(apply);
    setInProgress(apply);
  }, [destination]);
  const longPress = useCallback((video: Video) => onVideoLongPress(video, applyAction), [applyAction, onVideoLongPress]);
  const openInProgress = useCallback((video: Video) => onOpen(video, undefined, true), [onOpen]);

  const listHeader = <>
    {header}
    {home && inProgress.length > 0 ? <View style={styles.shelf}>
      <Text style={styles.sectionTitle}>{t("continueWatching")}</Text>
      <FlatList horizontal data={inProgress} keyExtractor={(video) => video.video_id} showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.shelfList}
        renderItem={({ item }) => <PhoneVideoCard compact video={item} language={language} t={t} onPress={openInProgress} onLongPress={longPress}
          thumbnail={source(item.thumbnail)!} channelAvatar={null} />} />
    </View> : null}
  </>;

  if (loading && videos.length === 0) return <View style={styles.center}><ActivityIndicator color={phoneColors.text} size="large" /></View>;
  return <FlatList data={feed} keyExtractor={(video) => video.video_id}
    ListHeaderComponent={listHeader}
    renderItem={({ item }) => <PhoneVideoCard video={item} language={language} t={t} onPress={open} onLongPress={longPress}
      thumbnail={source(item.thumbnail)!} channelAvatar={source(item.channel_thumbnail)} />}
    onEndReachedThreshold={1.5} onEndReached={() => { if (hasMore && !loadingMore && !loading && !error) void load(page + 1); }}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(0, true)} tintColor={phoneColors.text} colors={[phoneColors.accent]} progressBackgroundColor={phoneColors.surface} />}
    ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color={phoneColors.textMuted} /> : null}
    ListEmptyComponent={<View style={styles.empty}>
      <Text style={styles.emptyTitle}>{error ? t("cannotConnect") : t(empty.title)}</Text>
      {!error ? <Text style={styles.emptyText}>{t(empty.description)}</Text> : null}
      {error ? <Pressable style={styles.retry} onPress={() => void load(0)}><Text style={styles.retryText}>{t("tryAgain")}</Text></Pressable> : null}
    </View>}
    initialNumToRender={4} maxToRenderPerBatch={4} windowSize={7} removeClippedSubviews />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  shelf: { paddingTop: 8, paddingBottom: 18 },
  sectionTitle: { ...phoneType.section, color: phoneColors.text, paddingHorizontal: 16, paddingBottom: 10 },
  shelfList: { paddingHorizontal: 16, gap: 12 },
  footer: { paddingVertical: 24 },
  empty: { alignItems: "center", paddingVertical: 64, paddingHorizontal: 24, gap: 16 },
  emptyTitle: { ...phoneType.title, color: phoneColors.text, textAlign: "center" },
  emptyText: { ...phoneType.body, color: phoneColors.textMuted, textAlign: "center" },
  retry: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: phoneColors.surfaceRaised },
  retryText: { ...phoneType.body, color: phoneColors.text, fontWeight: "600" },
});
