import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { YtZeroApi } from "../api";
import { channelContentTabs, splitChannelVideos, type ChannelContentTab } from "../channelContent";
import type { Translate } from "../i18n";
import type { OpenVideo } from "../playbackQueue";
import type { Channel, ChannelAbout, Language, Video } from "../types";
import { useChannelSync } from "../useChannelSync";
import { PhoneChip } from "./PhoneChip";
import { PhoneVideoCard } from "./PhoneVideoCard";
import { phoneColors, phoneType } from "./phoneTheme";
import { useImageSource } from "./useImageSource";

type Props = {
  api: YtZeroApi; channelId: string; language: Language; t: Translate;
  shortsEnabled: boolean; videoUpdate: Video | null; onOpen: OpenVideo;
  onVideoLongPress: (video: Video, onChange: (updated: Video) => void) => void;
};

/** A channel on the phone: its header with follow and sync, live videos, then Videos or Shorts. */
export function PhoneChannelScreen({ api, channelId, language, t, shortsEnabled, videoUpdate, onOpen, onVideoLongPress }: Props) {
  const [about, setAbout] = useState<ChannelAbout | null>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [live, setLive] = useState<Video[]>([]);
  const [tab, setTab] = useState<ChannelContentTab>("videos");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState(false);
  const request = useRef(0);
  const pageRef = useRef(0);
  pageRef.current = page;
  const source = useImageSource(api);

  const load = useCallback(async (background = false) => {
    const id = ++request.current;
    if (!background) { setLoading(true); setError(false); }
    const pages = background ? pageRef.current + 1 : 1;
    const [channelResult, aboutResult, videosResult, liveResult] = await Promise.allSettled([
      api.channel(channelId), api.channelAbout(channelId),
      Promise.all(Array.from({ length: pages }, (_, index) => api.channelVideos(channelId, index))),
      api.channelLive(channelId),
    ]);
    if (id !== request.current) return;
    if (channelResult.status === "rejected" && aboutResult.status === "rejected") { setError(true); setLoading(false); return; }
    const nextAbout = aboutResult.status === "fulfilled" ? aboutResult.value : null;
    setAbout(nextAbout);
    setChannel(channelResult.status === "fulfilled" ? channelResult.value.channel
      : { channel_id: channelId, title: nextAbout?.title ?? channelId, thumbnail: nextAbout?.avatar ?? "", tags: [] } as Channel);
    if (videosResult.status === "fulfilled") {
      const last = videosResult.value[videosResult.value.length - 1]!;
      setVideos([...new Map(videosResult.value.flatMap((item) => item.videos).map((video) => [video.video_id, video])).values()]);
      setPage(last.page);
      setHasMore(last.videos.length === last.limit);
    } else { setVideos([]); setHasMore(false); }
    setLive(liveResult.status === "fulfilled" ? liveResult.value.videos : []);
    setLoading(false);
  }, [api, channelId]);
  const sync = useChannelSync(api, channelId, useCallback(() => load(true), [load]));

  useEffect(() => { setTab("videos"); void load(); return () => { request.current++; }; }, [load]);
  useEffect(() => {
    if (!videoUpdate) return;
    const apply = (list: Video[]) => list.map((video) => video.video_id === videoUpdate.video_id ? { ...video, ...videoUpdate } : video);
    setVideos(apply); setLive(apply);
  }, [videoUpdate]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || loading) return;
    const id = request.current;
    setLoadingMore(true);
    try {
      const result = await api.channelVideos(channelId, page + 1);
      if (id !== request.current) return;
      setVideos((current) => [...current, ...result.videos.filter((video) => !current.some((item) => item.video_id === video.video_id))]);
      setPage(result.page);
      setHasMore(result.videos.length === result.limit);
    } catch { /* The next scroll retries. */ } finally { if (id === request.current) setLoadingMore(false); }
  };

  const toggleFollow = async () => {
    if (!channel || followBusy) return;
    const followed = channel.followed === 1;
    setFollowBusy(true); setFollowError(false);
    try {
      await api.followChannel(channel.channel_id, !followed);
      setChannel((current) => current ? { ...current, followed: followed ? 0 : 1 } : current);
    } catch { setFollowError(true); } finally { setFollowBusy(false); }
  };

  const split = useMemo(() => splitChannelVideos(videos), [videos]);
  const tabs = useMemo(() => channelContentTabs(videos, about?.counts, shortsEnabled), [about?.counts, shortsEnabled, videos]);
  useEffect(() => { if (!tabs.some((item) => item.value === tab)) setTab("videos"); }, [tab, tabs]);
  const shown = tab === "shorts" ? split.shorts : split.videos;
  const open = useCallback((video: Video) => onOpen(video), [onOpen]);
  const longPress = useCallback((video: Video) => onVideoLongPress(video, (updated) => {
    const apply = (list: Video[]) => list.map((item) => item.video_id === updated.video_id ? updated : item);
    setVideos(apply); setLive(apply);
  }), [onVideoLongPress]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={phoneColors.text} size="large" accessibilityLabel={t("loadingChannel")} /></View>;
  if (error || !channel) return <View style={styles.center}>
    <Text style={styles.muted}>{t("channelLoadError")}</Text>
    <PhoneChip label={t("tryAgain")} onPress={() => void load()} />
  </View>;
  const avatar = source(channel.thumbnail || about?.avatar);
  const subscribers = about?.subscriberCount || channel.subscriber_count;
  const header = <View>
    <View style={styles.header}>
      {avatar ? <Image source={avatar} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.letter}>{channel.title.slice(0, 1)}</Text></View>}
      <View style={styles.headerCopy}>
        <Text numberOfLines={2} style={styles.title}>{channel.title}</Text>
        <Text numberOfLines={1} style={styles.muted}>{[about?.handle || channel.handle, subscribers ? `${subscribers} ${t("subscribers")}` : ""].filter(Boolean).join(" · ")}</Text>
      </View>
    </View>
    <View style={styles.actions}>
      <PhoneChip primary={channel.followed !== 1} label={t(channel.followed === 1 ? "unfollow" : "follow")} disabled={followBusy} onPress={() => void toggleFollow()} />
      <PhoneChip label={sync.working ? t("syncingChannel") : t("syncChannel")} disabled={sync.working || Boolean(sync.busy)} onPress={() => void sync.start()} />
    </View>
    {followError ? <Text style={styles.error}>{t("channelFollowError")}</Text> : null}
    {sync.statusError ? <Text style={styles.error}>{t("channelSyncStatusError")}</Text> : sync.busy && !sync.working ? <Text style={styles.note}>{t("channelSyncBusy")}</Text> : null}
    {live.length > 0 ? <>
      <Text style={styles.section}>{t("liveBadge")}</Text>
      {live.map((video) => <PhoneVideoCard key={`live:${video.video_id}`} video={video} language={language} t={t} onPress={open} onLongPress={longPress}
        thumbnail={source(video.thumbnail)!} channelAvatar={avatar} />)}
    </> : null}
    {tabs.length > 1 ? <View style={styles.tabs}>
      {tabs.map((item) => <PhoneChip key={item.value} label={item.value === "shorts" ? t("navShorts") : t("videos")} primary={tab === item.value} onPress={() => setTab(item.value)} />)}
    </View> : null}
  </View>;
  return <FlatList data={shown} keyExtractor={(video) => video.video_id} ListHeaderComponent={header}
    renderItem={({ item }) => <PhoneVideoCard video={item} language={language} t={t} onPress={open} onLongPress={longPress} thumbnail={source(item.thumbnail)!} channelAvatar={avatar} />}
    onEndReachedThreshold={1.5} onEndReached={() => void loadMore()}
    ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color={phoneColors.textMuted} /> : null}
    ListEmptyComponent={<Text style={[styles.muted, styles.empty]}>{t(tab === "shorts" ? "channelShortsEmpty" : "channelVideosEmpty")}</Text>}
    initialNumToRender={4} maxToRenderPerBatch={4} windowSize={7} removeClippedSubviews />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  header: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingTop: 8 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: phoneColors.surface },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  letter: { color: phoneColors.text, fontSize: 24, fontWeight: "700" },
  headerCopy: { flex: 1, gap: 4 },
  title: { ...phoneType.heading, color: phoneColors.text },
  muted: { ...phoneType.body, color: phoneColors.textMuted, textAlign: "left" },
  actions: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 14 },
  error: { ...phoneType.body, color: phoneColors.danger, paddingHorizontal: 16, paddingTop: 8 },
  note: { ...phoneType.body, color: phoneColors.textMuted, paddingHorizontal: 16, paddingTop: 8 },
  section: { ...phoneType.section, color: phoneColors.text, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 10 },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 12 },
  footer: { paddingVertical: 24 },
  empty: { padding: 24, textAlign: "center" },
});
