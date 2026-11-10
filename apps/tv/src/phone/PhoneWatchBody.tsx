import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { YtZeroApi } from "../api";
import { formatVideoDuration } from "../duration";
import type { Translate } from "../i18n";
import type { Language, Video, VideoComment } from "../types";
import { PhoneComments } from "./PhoneComments";
import { formatVideoCardMetadata } from "../videoMetadata";
import { PhoneChip } from "./PhoneChip";
import { PhoneDownloadChip } from "./PhoneDownloadStatus";
import { canDownloadToPhone } from "../phoneDownloads";
import { PhoneVideoCard } from "./PhoneVideoCard";
import { phoneColors, phoneType } from "./phoneTheme";

type Props = {
  api: YtZeroApi; video: Video; related: Video[]; showRelated: boolean; nextVideo: Video | null;
  loading: boolean; loadError: boolean; saveFailed: boolean; playing: boolean; startAt: number;
  queued: boolean; canQueue: boolean; queueFull: boolean;
  language: Language; t: Translate; playbackTime: (seconds: number) => string;
  onRetry: () => void; onPlay: (position: number) => void; onToggleQueue: () => void;
  onOpenNext: () => void; onOpenRelated: (video: Video) => void; onOpenChannel?: () => void;
  onMore: () => void; onRelatedLongPress: (video: Video) => void;
  /** Comments, or null when the profile hides them. */
  comments: { list: VideoComment[] | null; loading: boolean; error: boolean; onLoad: () => void } | null;
  /** The video fills the page, with the system bars hidden. */
  fullscreen: boolean;
  /** The inline player, drawn over the 16:9 area at the top while a video plays. */
  player: ReactNode;
};

/**
 * The phone details page: the video across the top (the player while it
 * plays, otherwise its thumbnail), then title, actions, description, up next
 * and related videos scrolling below.
 */
export function PhoneWatchBody(props: Props) {
  const { api, video, related, showRelated, nextVideo, loading, loadError, saveFailed, playing, startAt, queued, canQueue, queueFull, language, t, fullscreen } = props;
  const [expanded, setExpanded] = useState(false);
  const metadata = useMemo(() => formatVideoCardMetadata(video, language, t("views")), [language, t, video]);
  const duration = formatVideoDuration(video.duration);
  const sources = useRef(new Map<string, ImageSourcePropType>());
  const source = useCallback((url: string | null | undefined): ImageSourcePropType | null => {
    if (!url) return null;
    let cached = sources.current.get(url);
    if (!cached) { cached = api.thumbnailSource(url) as ImageSourcePropType; sources.current.set(url, cached); }
    return cached;
  }, [api]);
  const channelAvatar = source(video.channel_thumbnail);
  return <View style={styles.screen}>
    <View style={fullscreen ? styles.fill : styles.hero}>
      {playing ? props.player : <Pressable accessibilityRole="button" accessibilityLabel={t("playVideo")} style={styles.fill} onPress={() => props.onPlay(startAt)}>
        {video.thumbnail ? <Image source={source(video.thumbnail)!} style={styles.fill} resizeMode="cover" /> : null}
        <View style={styles.playShade}><View style={styles.playCircle}>
          <Svg width={34} height={34} viewBox="0 0 24 24"><Path fill="#fff" d="M8 5.5v13l10.5-6.5z" /></Svg>
        </View></View>
        {duration ? <View style={styles.duration}><Text style={styles.durationText}>{duration}</Text></View> : null}
      </Pressable>}
    </View>
    {fullscreen ? null : <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
      {loadError ? <View style={styles.notice}>
        <Text style={styles.noticeText}>{t("videoLoadError")}</Text>
        <PhoneChip label={t("tryAgain")} onPress={props.onRetry} />
      </View> : null}
      <Text accessibilityRole="header" style={styles.title}>{video.title}</Text>
      {metadata ? <Text style={styles.meta}>{metadata}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={video.channel_title ?? ""} disabled={!props.onOpenChannel} onPress={props.onOpenChannel}
        style={({ pressed }) => [styles.channel, pressed && styles.pressed]}>
        {channelAvatar ? <Image source={channelAvatar} style={styles.avatar} />
          : <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarLetter}>{(video.channel_title ?? "?").slice(0, 1)}</Text></View>}
        <Text numberOfLines={1} style={styles.channelName}>{video.channel_title}</Text>
        {loading ? <ActivityIndicator color={phoneColors.textMuted} /> : null}
      </Pressable>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actions}>
        {!playing ? <PhoneChip primary label={startAt > 0 ? `${t("resumePlayback")} · ${props.playbackTime(startAt)}` : t("playVideo")} onPress={() => props.onPlay(startAt)} /> : null}
        {!playing && startAt > 0 ? <PhoneChip label={t("playFromStart")} onPress={() => props.onPlay(0)} /> : null}
        {queued || canQueue ? <PhoneChip label={t(queued ? "removeFromQueue" : queueFull ? "queueFull" : "addToQueue")} disabled={!queued && queueFull} onPress={props.onToggleQueue} /> : null}
        <PhoneDownloadChip video={video} t={t} language={language} canStart={canDownloadToPhone(video)} />
        <PhoneChip label={t("more")} onPress={props.onMore} />
      </ScrollView>
      {saveFailed ? <Text style={styles.error}>{t("playbackSaveError")}</Text> : null}
      {video.description ? <Pressable accessibilityRole="button" accessibilityLabel={t("descriptionTitle")} onPress={() => setExpanded((value) => !value)} style={styles.description}>
        <Text numberOfLines={expanded ? undefined : 3} style={styles.descriptionText}>{video.description}</Text>
      </Pressable> : null}
      {props.comments ? <PhoneComments api={api} comments={props.comments.list} loading={props.comments.loading} error={props.comments.error} t={t} onLoad={props.comments.onLoad} /> : null}
      {nextVideo ? <>
        <Text style={styles.section}>{t("upNext")}</Text>
        <PhoneVideoCard video={nextVideo} language={language} t={t} onPress={props.onOpenNext}
          thumbnail={source(nextVideo.thumbnail)!} channelAvatar={source(nextVideo.channel_thumbnail)} />
      </> : null}
      {showRelated && related.length > 0 ? <>
        <Text style={styles.section}>{t("relatedVideos")}</Text>
        {related.map((item) => <PhoneVideoCard key={item.video_id} video={item} language={language} t={t} onPress={props.onOpenRelated} onLongPress={props.onRelatedLongPress}
          thumbnail={source(item.thumbnail)!} channelAvatar={source(item.channel_thumbnail)} />)}
      </> : null}
    </ScrollView>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  fill: { flex: 1 },
  hero: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000" },
  playShade: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.25)" },
  playCircle: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.6)" },
  duration: { position: "absolute", right: 8, bottom: 8, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, backgroundColor: "rgba(0,0,0,0.8)" },
  durationText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  content: { paddingBottom: 140 },
  notice: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  noticeText: { flex: 1, ...phoneType.body, color: phoneColors.danger },
  title: { ...phoneType.title, fontSize: 18, lineHeight: 24, color: phoneColors.text, paddingHorizontal: 16, paddingTop: 12 },
  meta: { ...phoneType.caption, color: phoneColors.textMuted, paddingHorizontal: 16, paddingTop: 4 },
  channel: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 14 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: phoneColors.surface },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarLetter: { color: phoneColors.text, fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.6 },
  channelName: { flex: 1, ...phoneType.title, color: phoneColors.text },
  actions: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 14 },
  error: { ...phoneType.body, color: phoneColors.danger, paddingHorizontal: 16, paddingTop: 10 },
  description: { margin: 16, marginBottom: 4, padding: 12, borderRadius: 12, backgroundColor: phoneColors.surface },
  descriptionText: { ...phoneType.body, color: phoneColors.text },
  section: { ...phoneType.section, color: phoneColors.text, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 10 },
});
