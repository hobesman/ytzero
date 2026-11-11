import { TvGridList, type TvGridListRef } from "../components/TvGridList";
import { TvEmptyState } from "../components/TvEmptyState";
import { browseEmptyState } from "../emptyState";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, TVFocusGuideView, StyleSheet, Text, View, type FocusDestination, type ListRenderItemInfo, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import type { YtZeroApi } from "../api";
import type { Translate } from "../i18n";
import { TvPageHeading } from "../components/TvPageHeading";
import { navigationLabelKey, type TvBrowseDestination } from "../navigation";
import type { Channel, Language, Tag, Video } from "../types";
import { TvButton } from "../components/TvButton";
import { TvFeaturedVideo } from "../components/TvFeaturedVideo";
import { TvChannelShelf } from "../components/TvChannelShelf";
import { TvLoadingMark } from "../components/TvLoadingMark";
import { TvShortCard } from "../components/TvShortCard";
import { TvTagFilter } from "../components/TvTagFilter";
import { TvVideoShelf } from "../components/TvVideoShelf";
import type { VideoActionOptions } from "../components/TvVideoActionMenu";
import { VideoCard } from "../components/VideoCard";
import { channelsForTags, dueScheduledVideos, scheduledVideosInOrder, staysInProgress, visibleFeedTags, withoutInProgress } from "../feedSections";
import { focusWhenReady, useContentFocusAllowed } from "../focus";
import { colors, typography, screenPadding } from "../theme";
import { browseQueue, type OpenVideo } from "../playbackQueue";
import { tvGridListPerformance } from "../listPerformance";
import { usePaginationFocus } from "../usePaginationFocus";
import { useContentSwap } from "../components/useContentSwap";

type FeedSort = "published" | "arrival";
const videoKey = (video: Video) => video.video_id;

type Props = {
  active: boolean;
  api: YtZeroApi;
  videoUpdate: Video | null;
  destination: TvBrowseDestination;
  feedSort: FeedSort;
  focusRequest: number;
  language: Language;
  profileFocusTarget: FocusDestination;
  showTopChannels: boolean;
  onPrimaryFocusTarget: (target: View | null) => void;
  onBackdropChange: (thumbnail: string) => void;
  onBackdropScroll: Animated.Value;
  t: Translate;
  onOpenChannel: (channel: Channel) => void;
  onSearch: () => void;
  onOpen: OpenVideo;
  onVideoLongPress: (video: Video, onChange: (updated: Video) => void, options?: VideoActionOptions) => void;
  viewportHeight: number;
  viewportWidth: number;
};

export function FeedScreen({ active, api, videoUpdate, destination, feedSort, focusRequest, language, profileFocusTarget, showTopChannels, onPrimaryFocusTarget, onBackdropChange, onBackdropScroll, t, onOpenChannel, onSearch, onOpen, onVideoLongPress, viewportHeight: height, viewportWidth: width }: Props) {
  const contentFocusAllowed = useContentFocusAllowed();
  const home = destination === "/";
  const shortsView = destination === "/shorts";
  const columns = shortsView
    ? width >= 1700 ? 5 : width >= 1220 ? 4 : 3
    : width >= 1400 ? 4 : 3;
  const contentWidth = Math.max(720, width - screenPadding * 2);
  const columnGap = shortsView ? 24 : 28;
  const cardWidth = Math.floor((contentWidth - (columns - 1) * columnGap) / columns);
  const shelfCardWidth = Math.min(380, Math.floor((contentWidth - 3 * 26) / 4));
  const [videos, setVideos] = useState<Video[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [appliedFilter, setAppliedFilter] = useState({ tags: [] as number[], sort: feedSort });
  const [inProgress, setInProgress] = useState<Video[]>([]);
  const inProgressRef = useRef(inProgress);
  inProgressRef.current = inProgress;
  const [scheduled, setScheduled] = useState<Video[]>([]);
  const [topChannels, setTopChannels] = useState<Channel[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [hasSubscriptions, setHasSubscriptions] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialFeedLoaded, setInitialFeedLoaded] = useState(false);
  const [preludeLoading, setPreludeLoading] = useState(home);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const feedRequestId = useRef(0);
  const handledFocusRequest = useRef<number | null>(null);
  const [firstVideoTarget, setFirstVideoTarget] = useState<View | null>(null);
  const [featuredTarget, setFeaturedTarget] = useState<View | null>(null);
  const [featuredStripTarget, setFeaturedStripTarget] = useState<View | null>(null);
  const [heroVisible, setHeroVisible] = useState(true);
  const heroVisibleRef = useRef(true);
  const [firstContinueTarget, setFirstContinueTarget] = useState<View | null>(null);
  const [firstTagTarget, setFirstTagTarget] = useState<View | null>(null);
  const [firstChannelTarget, setFirstChannelTarget] = useState<View | null>(null);
  const retryRef = useRef<View>(null);
  const emptyRef = useRef<View>(null);
  const listRef = useRef<TvGridListRef<Video>>(null);
  const headerRef = useRef<View>(null);
  const filterHeadingRef = useRef<View>(null);
  const filterChangePending = useRef(false);
  const filterFocused = useRef(false);
  const scrollOffset = useRef(0);
  const hasContent = useRef(false);
  const contentSwap = useContentSwap();
  const setFilterFocused = useCallback((focused: boolean) => { filterFocused.current = focused; }, []);

  const load = useCallback(async (nextPage: number, beforeAppend?: () => Promise<void>) => {
    const requestId = ++feedRequestId.current;
    const current = () => requestId === feedRequestId.current;
    nextPage === 0 ? setLoading(true) : setLoadingMore(true);
    setError(false);
    try {
      const result = home
        ? await api.feed({ page: nextPage, sort: feedSort, tags: selectedTags }).then((feed) => ({
            videos: feed.videos,
            page: feed.page,
            hasMore: feed.videos.length === feed.limit,
          }))
        : await api.browse(destination, { page: nextPage, showAll: false, sort: feedSort });
      if (!current()) return;
      await beforeAppend?.();
      if (!current()) return;
      const commit = () => {
        setVideos((previous) => nextPage === 0 ? result.videos : [...previous, ...result.videos]);
        if (nextPage === 0) setAppliedFilter({ tags: selectedTags, sort: feedSort });
        setPage(result.page);
        setHasMore(result.hasMore);
      };
      if (nextPage === 0 && hasContent.current) {
        const anchor = filterChangePending.current && filterFocused.current
          ? await new Promise<number | null>((resolve) => {
              if (!filterHeadingRef.current) { resolve(null); return; }
              filterHeadingRef.current.measureInWindow((_x, y) => resolve(y));
            }) : null;
        await contentSwap.swap(current, commit, async () => {
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          if (!current() || anchor === null || !filterFocused.current || !filterHeadingRef.current) return;
          await new Promise<void>((resolve) => filterHeadingRef.current!.measureInWindow((_x, y) => {
            if (current() && filterFocused.current) {
              listRef.current?.scrollToOffset({ offset: Math.max(0, scrollOffset.current + y - anchor), animated: false });
            }
            requestAnimationFrame(() => resolve());
          }));
        });
      } else commit();
      if (current()) filterChangePending.current = false;
    } catch {
      if (requestId === feedRequestId.current) {
        setError(true);
      }
    } finally {
      if (requestId === feedRequestId.current) {
        if (nextPage === 0) { hasContent.current = true; setInitialFeedLoaded(true); }
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [api, contentSwap, destination, feedSort, home, selectedTags]);

  useEffect(() => { void load(0); return () => { feedRequestId.current++; contentSwap.cancel(); }; }, [contentSwap, load]);

  useEffect(() => {
    if (!home) return;
    setPreludeLoading(true);
    void Promise.allSettled([
      api.tags().then((result) => setTags(result.tags)),
      api.inProgress().then((result) => setInProgress(result.videos.filter((video) => video.is_short === 0))),
      api.watchlist().then((result) => setScheduled(result.videos)),
      showTopChannels ? api.topChannels().then((result) => setTopChannels(result.channels)) : Promise.resolve(),
      api.channels().then((result) => { setChannels(result.channels); setHasSubscriptions(result.channels.some((channel) => channel.followed === 1)); }),
    ]).then(() => setPreludeLoading(false));
  }, [api, home, showTopChannels]);

  const screenLoading = !initialFeedLoaded || preludeLoading;

  useEffect(() => {
    if (screenLoading || !contentFocusAllowed) return;
    const target = home
      ? featuredTarget ?? firstContinueTarget ?? firstChannelTarget ?? firstTagTarget ?? firstVideoTarget
      : firstVideoTarget;
    const destinationTarget = target ?? (error ? retryRef.current : emptyRef.current);
    if (!destinationTarget || handledFocusRequest.current === focusRequest) return;
    return focusWhenReady(destinationTarget, () => { handledFocusRequest.current = focusRequest; });
  }, [contentFocusAllowed, destination, error, featuredTarget, firstChannelTarget, firstContinueTarget, firstTagTarget, firstVideoTarget, focusRequest, home, screenLoading]);

  const visibleTags = useMemo(() => visibleFeedTags(tags), [tags]);
  const dueScheduled = useMemo(() => dueScheduledVideos(scheduled), [scheduled]);
  const featured = home && appliedFilter.tags.length === 0 && dueScheduled.length > 0;
  useEffect(() => { onBackdropScroll.setValue(0); }, [onBackdropScroll]);
  const feedVideos = useMemo(() => home ? withoutInProgress(videos, [...inProgress, ...(featured ? dueScheduled : [])])
    : destination === "/watchlist" ? scheduledVideosInOrder(videos) : videos, [destination, featured, home, inProgress, dueScheduled, videos]);
  const feedVideoIds = useMemo(() => feedVideos.map(videoKey), [feedVideos]);
  const pagination = usePaginationFocus(feedVideoIds, columns, hasMore, `${destination}:${feedSort}:${selectedTags.join(",")}`);
  const queueContext = useMemo(() => browseQueue(destination, feedVideos, appliedFilter.sort, appliedFilter.tags), [destination, feedVideos, appliedFilter]);
  const visibleChannels = useMemo(
    () => channelsForTags(topChannels, channels, appliedFilter.tags),
    [channels, appliedFilter.tags, topChannels],
  );
  const gridPerformance = useMemo(() => tvGridListPerformance(columns), [columns]);
  const thumbnailSource = useCallback((thumbnail: string) => api.thumbnailSource(thumbnail), [api]);
  const backdropScrollEvent = useMemo(() => Animated.event(
    [{ nativeEvent: { contentOffset: { y: onBackdropScroll } } }],
    { useNativeDriver: true },
  ), [onBackdropScroll]);
  const settleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!home) return;
    const offset = event.nativeEvent.contentOffset.y;
    scrollOffset.current = offset;
    const visible = offset < height * 0.45;
    if (visible !== heroVisibleRef.current) {
      heroVisibleRef.current = visible;
      setHeroVisible(visible);
    }
  }, [height, home]);
  const gridFocusUpTarget = home
    ? firstTagTarget ?? firstChannelTarget ?? firstContinueTarget ?? featuredStripTarget ?? featuredTarget ?? profileFocusTarget
    : profileFocusTarget;

  useEffect(() => {
    const primaryTarget = home
      ? featuredTarget ?? firstContinueTarget ?? firstChannelTarget ?? firstTagTarget ?? firstVideoTarget
      : firstVideoTarget;
    onPrimaryFocusTarget(screenLoading ? null : primaryTarget ?? (error ? retryRef.current : emptyRef.current));
    return () => onPrimaryFocusTarget(null);
  }, [error, featuredTarget, firstChannelTarget, firstContinueTarget, firstTagTarget, firstVideoTarget, home, onPrimaryFocusTarget, screenLoading]);

  const toggleTag = useCallback((tagId: number) => {
    feedRequestId.current++;
    contentSwap.cancel();
    filterChangePending.current = true;
    setSelectedTags((current) => current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId]);
  }, [contentSwap]);

  const clearTags = useCallback(() => {
    feedRequestId.current++;
    contentSwap.cancel();
    filterChangePending.current = true;
    setSelectedTags([]);
  }, [contentSwap]);

  const applyVideoChange = useCallback((updated: Video) => {
    setVideos((current) => current
      .map((video) => video.video_id === updated.video_id ? updated : video)
      .filter((video) => {
        if (video.video_id !== updated.video_id) return true;
        if (destination === "/archive") return updated.status === "archived";
        if (destination === "/watchlist") return updated.status === "queued";
        return updated.status !== "archived";
      }));
    setInProgress((current) => current
      .map((video) => video.video_id === updated.video_id ? updated : video)
      .filter((video) => video.video_id !== updated.video_id || staysInProgress(updated)));
    // A video started from elsewhere joins Continue watching once its progress is saved.
    if (home && updated.is_short === 0 && staysInProgress(updated) && !inProgressRef.current.some((video) => video.video_id === updated.video_id)) {
      void api.inProgress().then((result) => setInProgress(result.videos.filter((video) => video.is_short === 0))).catch(() => {});
    }
    setScheduled((current) => {
      const withoutVideo = current.filter((video) => video.video_id !== updated.video_id);
      return updated.status === "queued" ? [...withoutVideo, updated] : withoutVideo;
    });
  }, [api, destination, home]);

  // Playback updates individual entries; remounting the screen here discards
  // the originating card, loaded pages, filters and scroll position.
  useEffect(() => { if (videoUpdate) applyVideoChange(videoUpdate); }, [applyVideoChange, videoUpdate]);

  const removeFromHistory = useCallback(async (video: Video) => {
    if (video.history_id == null) return;
    await api.removeFromHistory(video.history_id);
    setVideos((current) => current.filter((item) => item.video_id !== video.video_id));
  }, [api]);

  const header = (
    <View ref={headerRef} collapsable={false}>
      {!home ? <TvPageHeading title={t(navigationLabelKey(destination))} /> : null}
      {featured ? <TvFeaturedVideo ref={setFeaturedTarget} videos={dueScheduled} height={height * 0.53} t={t}
        active={active && heroVisible} thumbnailSource={thumbnailSource} onThumbnailsTarget={setFeaturedStripTarget}
        onBackdropChange={onBackdropChange}
        onOpen={(video, play) => onOpen(video, { version: 1, kind: "watchlist", sort: "schedule", dueOnly: true }, play)}
        nextFocusUp={profileFocusTarget} nextFocusDown={firstContinueTarget ?? firstChannelTarget ?? firstTagTarget ?? firstVideoTarget ?? undefined} /> : null}
      {home ? <TvVideoShelf title={t("continueWatching")} videos={inProgress} cardWidth={shelfCardWidth}
        firstItemRef={setFirstContinueTarget} language={language} nextFocusUp={featuredStripTarget ?? profileFocusTarget}
        nextFocusDown={firstChannelTarget ?? firstTagTarget ?? firstVideoTarget ?? undefined} thumbnailSource={thumbnailSource}
        onOpen={(video) => onOpen(video, video.playback_context ?? { version: 1, kind: "in-progress" })}
        onLongPress={(video) => onVideoLongPress(video, applyVideoChange)} viewsLabel={t("views")} /> : null}
      {home && showTopChannels ? <TvChannelShelf title={t("watchedChannels")} liveLabel={t("liveBadge")} channels={visibleChannels}
        firstItemRef={setFirstChannelTarget} thumbnailSource={thumbnailSource} onOpen={onOpenChannel}
        nextFocusUp={firstContinueTarget ?? featuredStripTarget ?? profileFocusTarget} nextFocusDown={firstTagTarget ?? firstVideoTarget ?? undefined} /> : null}
      {home ? <View ref={filterHeadingRef} collapsable={false} style={styles.heading}>
        <View style={styles.filterTitle}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{t("feedVideos")}</Text>
          <View style={styles.filterLoading}>{loading ? <TvLoadingMark accessibilityLabel={t("loadingFeed")} size={24} /> : null}</View>
        </View>
        <TvTagFilter tags={visibleTags} selected={selectedTags} profileFocusTarget={firstChannelTarget ?? firstContinueTarget ?? featuredStripTarget ?? profileFocusTarget}
          nextFocusDown={firstVideoTarget ?? undefined} firstTagRef={setFirstTagTarget} onFocusChange={setFilterFocused} onToggle={toggleTag} onClear={clearTags} clearLabel={t("clearFilters")} />
      </View> : null}
      {error && <View style={styles.errorRow}>
        <Text style={styles.error}>{t("loadError")}</Text>
        <TvButton ref={retryRef} label={t("refresh")} nextFocusUp={profileFocusTarget} onPress={() => void load(0)} />
      </View>}
    </View>
  );

  const renderVideo = useCallback(({ item, index }: ListRenderItemInfo<Video>) => {
    const focusProps = {
      ref: pagination.itemRef(item.video_id, index === 0 ? setFirstVideoTarget : undefined),
      nextFocusDown: pagination.down(index),
      nextFocusUp: index < columns ? gridFocusUpTarget : undefined,
      onFocusChange: (focused: boolean) => { pagination.onItemFocus(item.video_id, focused); },
      onLongPress: () => onVideoLongPress(
        item,
        applyVideoChange,
        destination === "/history" && item.history_id != null ? { onRemove: () => removeFromHistory(item) } : undefined,
      ),
      onPress: () => onOpen(item, queueContext),
      channelSource: api.thumbnailSource(item.channel_thumbnail ?? ""),
    };
    return shortsView ? (
      <TvShortCard
        {...focusProps}
        video={item}
        width={cardWidth}
        language={language}
        portraitSource={api.shortThumbnailSource(item.video_id)}
        fallbackSource={api.thumbnailSource(item.thumbnail)}
        viewsLabel={t("views")}
      />
    ) : (
      <VideoCard
        {...focusProps}
        video={item}
        width={cardWidth}
        language={language}
        thumbnailSource={api.thumbnailSource(item.thumbnail)}
        viewsLabel={t("views")}
      />
    );
  }, [pagination, api, applyVideoChange, cardWidth, columns, destination, gridFocusUpTarget, language, onOpen, queueContext, onVideoLongPress, removeFromHistory, shortsView, t]);

  const emptyPresentation = browseEmptyState(destination, appliedFilter.tags.length > 0, hasSubscriptions, Boolean(featured || (home && (inProgress.length > 0 || visibleChannels.length > 0))));

  if (screenLoading) {
    return (
      <View style={[styles.loadingScreen, { width, height }]}>
        <TvLoadingMark accessibilityLabel={t("loadingFeed")} />
      </View>
    );
  }

  return (
    <Animated.View
      style={[styles.screen, home && styles.homeScreen, { width, height, transform: [{ translateY: contentSwap.translateY }] }]}
    >
      <TvGridList
        ref={listRef}
        key={`${destination}-${columns}`}
        style={[styles.list, { width, height }]}
        contentContainerStyle={[styles.content, !featured && styles.withoutHero, { minHeight: height }]}
        data={feedVideos}
        onScroll={home ? backdropScrollEvent : undefined}
        onMomentumScrollEnd={settleScroll}
        onScrollEndDrag={settleScroll}
        scrollEventThrottle={16}
        columns={columns}
        rowStyle={shortsView ? styles.shortRow : styles.row}
        keyExtractor={videoKey}
        ListHeaderComponent={header}
        ListEmptyComponent={!error ? (
          <TvEmptyState art={emptyPresentation.art} icon={emptyPresentation.icon} title={t(emptyPresentation.title)} description={t(emptyPresentation.description)}
            action={<TvButton ref={emptyRef} deferPress={home && hasSubscriptions === false} label={t(home && appliedFilter.tags.length ? "clearFilters" : home && hasSubscriptions === false ? "searchTitle" : "refresh")} nextFocusUp={profileFocusTarget} onPress={() => home && appliedFilter.tags.length ? clearTags() : home && hasSubscriptions === false ? onSearch() : void load(0)} />} />
        ) : null}
        ListFooterComponent={(
          <>
          {hasMore && feedVideos.length > 0 ? (
          <TVFocusGuideView destinations={pagination.destinations} style={styles.footer}>
            <TvButton ref={pagination.buttonRef} onFocus={pagination.onButtonFocus} onBlur={pagination.onButtonBlur} nextFocusUp={pagination.up} label={loadingMore ? t("loadingFeed") : t("loadMore")} accessibilityState={{ busy: loadingMore || loading }} onPress={() => { if (!loadingMore && !loading) void pagination.load((beforeAppend) => load(page + 1, beforeAppend)); }} />
          </TVFocusGuideView>
        ) : null}
          </>
        )}
        renderItem={renderVideo}
        {...gridPerformance}
      />
    </Animated.View>
  );

}

const styles = StyleSheet.create({
  homeScreen: { backgroundColor: "transparent" },
  sectionTitle: { color: colors.text, fontSize: 27, lineHeight: 34, fontWeight: "700", marginHorizontal: 20 },
  withoutHero: { paddingTop: 132 },
  screen: { flexGrow: 0, flexShrink: 0, backgroundColor: colors.background },
  loadingScreen: { flexGrow: 0, flexShrink: 0, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  // Fabric on react-native-tvos can collapse a multi-column FlatList to one
  // pixel when only flex sizing is used, so keep both dimensions explicit.
  list: { flexGrow: 0, flexShrink: 0 },
  content: { paddingHorizontal: screenPadding, paddingTop: 48, paddingBottom: 80 },
  heading: { width: "100%", alignItems: "flex-start", marginTop: 8, marginBottom: 24 },
  filterTitle: { flexDirection: "row", alignItems: "center" },
  filterLoading: { width: 28, height: 28, justifyContent: "center", alignItems: "center" },
  row: { gap: 28 },
  shortRow: { gap: 24 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 22, marginBottom: 28 },
  error: { color: colors.danger, fontSize: typography.caption.fontSize, fontWeight: "700" },
  footer: { alignItems: "center", paddingTop: 14, paddingBottom: 30 },
});
