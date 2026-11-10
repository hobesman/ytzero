import { useEffect, useState, type ReactNode } from "react";
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import type { YtZeroApi } from "../api";
import { formatVideoDuration } from "../duration";
import { localeTags, type Translate } from "../i18n";
import { downloadFraction, formatBytes, type PhoneDownload } from "../phoneDownloads";
import type { Language, Video } from "../types";
import { usePhoneDownloads } from "../usePhoneDownloads";
import { confirmDeleteDownload, downloadStatusLabel } from "./PhoneDownloadStatus";
import { PhoneChip } from "./PhoneChip";
import { phoneColors, phoneType } from "./phoneTheme";

type Props = {
  api: YtZeroApi; t: Translate; language: Language;
  onOpen: (video: Video) => void;
  /** Shown above the list, such as the offline notice. */
  header?: ReactNode;
};

/** Library → On this phone: the videos saved here, how much space they use, and their downloads. */
export function PhoneDownloadsScreen({ api, t, language, onOpen, header }: Props) {
  const store = usePhoneDownloads();
  const items = store.downloads();
  const used = store.usedBytes();
  const [free, setFree] = useState<number | null>(null);
  const finished = items.filter((item) => item.state === "done").length;
  useEffect(() => { void store.freeBytes().then(setFree); }, [store, finished]);
  const locale = localeTags[language];

  const deleteAll = () => Alert.alert(t("deleteAllDownloads"), t("deleteAllDownloadsConfirm").replace("{count}", String(items.length)), [
    { text: t("cancel"), style: "cancel" },
    { text: t("deleteAllDownloads"), style: "destructive", onPress: () => void store.removeAll() },
  ]);
  const listHeader = <>
    {header}
    {items.length ? <View style={styles.summary}>
      <Text style={styles.storage}>{t("downloadsStorage").replace("{used}", formatBytes(used, locale)).replace("{free}", free === null ? "–" : formatBytes(free, locale))}</Text>
      <PhoneChip label={t("deleteAllDownloads")} onPress={deleteAll} />
    </View> : null}
  </>;
  return <FlatList data={items} keyExtractor={(item) => item.videoId} ListHeaderComponent={listHeader}
    renderItem={({ item }) => <DownloadRow item={item} api={api} t={t} language={language} onOpen={onOpen} />}
    ListEmptyComponent={<View style={styles.empty}>
      <Text style={styles.emptyTitle}>{t("downloadsEmpty")}</Text>
      <Text style={styles.emptyText}>{t("downloadsEmptyHint")}</Text>
    </View>} />;
}

function DownloadRow({ item, api, t, language, onOpen }: { item: PhoneDownload; api: YtZeroApi; t: Translate; language: Language; onOpen: (video: Video) => void }) {
  const store = usePhoneDownloads();
  const { video } = item;
  const done = item.state === "done";
  const fraction = downloadFraction(item);
  const watched = video.watch_position && video.watch_duration ? Math.max(0, Math.min(1, video.watch_position / video.watch_duration)) : 0;
  const duration = formatVideoDuration(video.duration);
  const thumbnail = video.thumbnail ? api.thumbnailSource(video.thumbnail) as ImageSourcePropType : null;
  const longPress = () => done ? confirmDeleteDownload(video, t) : Alert.alert(video.title, downloadStatusLabel(item, t, language), [
    { text: t("close"), style: "cancel" },
    item.state === "failed"
      ? { text: t("tryAgain"), onPress: () => void store.retry(video.video_id) }
      : { text: t("cancelDownload"), style: "destructive", onPress: () => void store.remove(video.video_id) },
  ]);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${video.title}. ${downloadStatusLabel(item, t, language)}`}
    onPress={done ? () => onOpen(video) : longPress} onLongPress={longPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
    <View style={styles.thumbnailFrame}>
      {thumbnail ? <Image source={thumbnail} style={styles.thumbnail} resizeMode="cover" /> : null}
      {duration ? <View style={styles.badge}><Text style={styles.badgeText}>{duration}</Text></View> : null}
      {done && watched > 0 ? <View style={styles.track}><View style={[styles.watched, { width: `${watched * 100}%` }]} /></View> : null}
    </View>
    <View style={styles.copy}>
      <Text numberOfLines={2} style={styles.title}>{video.title}</Text>
      <Text numberOfLines={1} style={styles.meta}>{video.channel_title}</Text>
      <Text numberOfLines={2} style={[styles.meta, item.state === "failed" && styles.failed]}>{downloadStatusLabel(item, t, language)}</Text>
      {!done && item.state !== "failed" ? <View style={styles.bar}><View style={[styles.barFill, { width: `${(fraction ?? 0) * 100}%` }]} /></View> : null}
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  summary: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  storage: { flex: 1, ...phoneType.body, color: phoneColors.textMuted },
  row: { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  pressed: { opacity: 0.7 },
  thumbnailFrame: { width: 144, aspectRatio: 16 / 9, borderRadius: 8, overflow: "hidden", backgroundColor: phoneColors.surface },
  thumbnail: { width: "100%", height: "100%" },
  badge: { position: "absolute", right: 4, bottom: 4, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, backgroundColor: "rgba(0,0,0,0.8)" },
  badgeText: { color: phoneColors.text, fontSize: 11, fontWeight: "600" },
  track: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3, backgroundColor: "rgba(255,255,255,0.3)" },
  watched: { height: 3, backgroundColor: "#ff0033" },
  copy: { flex: 1, gap: 3 },
  title: { ...phoneType.body, fontWeight: "600", color: phoneColors.text },
  meta: { ...phoneType.caption, color: phoneColors.textMuted },
  failed: { color: phoneColors.danger },
  bar: { height: 3, borderRadius: 2, marginTop: 4, backgroundColor: phoneColors.surfaceRaised, overflow: "hidden" },
  barFill: { height: 3, backgroundColor: phoneColors.text },
  empty: { alignItems: "center", paddingVertical: 64, paddingHorizontal: 24, gap: 12 },
  emptyTitle: { ...phoneType.title, color: phoneColors.text, textAlign: "center" },
  emptyText: { ...phoneType.body, color: phoneColors.textMuted, textAlign: "center" },
});
