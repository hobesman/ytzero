import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { YtZeroApi } from "../api";
import type { Translate } from "../i18n";
import type { Video } from "../types";
import { scheduleBuckets, useVideoActions } from "../useVideoActions";
import type { VideoCardActionConfig } from "../videoCardActions";
import { PhoneChip } from "./PhoneChip";
import { PhoneListRow } from "./PhoneList";
import { phoneColors, phoneType } from "./phoneTheme";

type Props = {
  api: YtZeroApi; actionConfig: VideoCardActionConfig; video: Video; t: Translate;
  onClose: () => void; onOpenChannel: (channelId: string) => void;
  onRemove?: () => Promise<void>; onVideoChange: (video: Video) => void;
};

const check = <Text style={{ color: phoneColors.accent, fontSize: 18, fontWeight: "700" }}>✓</Text>;
const chevron = <Text style={{ color: phoneColors.textMuted, fontSize: 22 }}>›</Text>;

/** A video's actions as a phone bottom sheet, with Schedule and Playlists as sub-lists. */
export function PhoneVideoActionSheet({ api, actionConfig, video, t, onClose, onOpenChannel, onRemove, onVideoChange }: Props) {
  const insets = useSafeAreaInsets();
  const actions = useVideoActions({ api, actionConfig, video, onClose, onRemove, onVideoChange, t });
  const { view, currentVideo, playlists, busy } = actions;
  const title = view === "actions" ? t("videoActions") : view === "schedule" ? t("scheduleVideo") : t("addToPlaylist");
  let body;
  if (!actions.verified) {
    body = <View style={styles.status}>
      {actions.metadataError ? <><Text style={styles.error}>{t("videoLoadError")}</Text><PhoneChip label={t("tryAgain")} onPress={actions.retryMetadata} /></>
        : <ActivityIndicator color={phoneColors.text} accessibilityLabel={t("loadingVideo")} />}
    </View>;
  } else if (view === "actions") {
    body = actions.mainItems.map((item) => item === "channel"
      ? <PhoneListRow key={item} title={t("goToChannel")} onPress={() => { if (!busy) { onClose(); onOpenChannel(currentVideo.channel_id!); } }} />
      : <PhoneListRow key={item} title={actions.actionLabel(item)} danger={item === "archive" || item === "remove"}
          trailing={busy === item ? <ActivityIndicator color={phoneColors.textMuted} /> : item === "schedule" || item === "playlist" ? chevron : undefined}
          onPress={item === "sessionQueue" && actions.queueFull ? undefined : () => actions.selectAction(item)} />);
  } else if (view === "schedule") {
    body = scheduleBuckets.map(({ bucket, label }) => {
      const selected = currentVideo.status === "queued" && currentVideo.bucket === bucket;
      return <PhoneListRow key={bucket} title={t(label)} detail={selected ? t("removeSchedule") : undefined}
        trailing={busy === `schedule-${bucket}` ? <ActivityIndicator color={phoneColors.textMuted} /> : selected ? check : undefined}
        onPress={() => actions.chooseSchedule(bucket)} />;
    });
  } else if (playlists === null) {
    body = <View style={styles.status}><ActivityIndicator color={phoneColors.text} accessibilityLabel={t("loadingPlaylists")} /></View>;
  } else if (playlists.length === 0) {
    body = <View style={styles.status}><Text style={styles.muted}>{t("playlistsEmpty")}</Text></View>;
  } else {
    body = playlists.map((playlist) => <PhoneListRow key={playlist.id} title={playlist.name}
      trailing={busy === `playlist-${playlist.id}` ? <ActivityIndicator color={phoneColors.textMuted} /> : playlist.has_video === 1 ? check : undefined}
      onPress={() => actions.togglePlaylist(playlist, playlist.has_video !== 1)} />);
  }
  return <Modal transparent visible animationType="slide" onRequestClose={actions.goBack} statusBarTranslucent navigationBarTranslucent>
    <Pressable accessibilityRole="button" accessibilityLabel={t("close")} style={styles.scrim} onPress={actions.close} />
    <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.handle} />
      <View style={styles.summary}>
        {view !== "actions" ? <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel={t("back")} onPress={actions.goBack}>
          <Text style={styles.back}>‹</Text>
        </Pressable> : currentVideo.thumbnail ? <Image source={api.thumbnailSource(currentVideo.thumbnail)} style={styles.thumbnail} /> : null}
        <View style={styles.summaryCopy}>
          <Text numberOfLines={2} style={styles.title}>{view === "actions" ? currentVideo.title : title}</Text>
          <Text numberOfLines={1} style={styles.muted}>{view === "actions" ? currentVideo.channel_title : currentVideo.title}</Text>
        </View>
      </View>
      <ScrollView style={styles.list}>{body}</ScrollView>
      {actions.error ? <Text style={[styles.error, styles.padded]}>{t("actionFailed")}</Text> : null}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { maxHeight: "75%", backgroundColor: phoneColors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8 },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: phoneColors.surfaceRaised, marginBottom: 8 },
  summary: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: phoneColors.divider },
  thumbnail: { width: 96, aspectRatio: 16 / 9, borderRadius: 6, backgroundColor: phoneColors.surfaceRaised },
  back: { color: phoneColors.text, fontSize: 32, lineHeight: 34, paddingHorizontal: 4 },
  summaryCopy: { flex: 1, gap: 2 },
  title: { ...phoneType.title, color: phoneColors.text },
  muted: { ...phoneType.caption, color: phoneColors.textMuted },
  list: { flexGrow: 0 },
  status: { alignItems: "center", gap: 12, padding: 24 },
  error: { ...phoneType.body, color: phoneColors.danger, textAlign: "center" },
  padded: { padding: 12 },
});
