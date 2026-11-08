import { TvEmptyState } from "./TvEmptyState";
import { TvCloseButton } from "./TvCloseButton";
import { formatVideoDuration } from "../duration";
import { useEffect, useState } from "react";
import {
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TVFocusGuideView,
  View,
} from "react-native";
import { PhoneOverlayScale, useScreenSize } from "./PhoneScale";
import type { YtZeroApi } from "../api";
import type { Translate } from "../i18n";
import { tvVerticalListPerformance } from "../listPerformance";
import { colors, typography } from "../theme";
import type { Video } from "../types";
import type { VideoCardActionConfig } from "../videoCardActions";
import { scheduleBuckets, useVideoActions, type VideoActionView } from "../useVideoActions";
import { TvButton } from "./TvButton";
import { TvLoadingMark } from "./TvLoadingMark";
import { TvListButton } from "./TvListButton";
import { TvScreenTransition } from "./TvScreenTransition";
import { useTvModalBack } from "../useTvModalBack";
import { TvFocusScope } from "./TvFocusScope";
import { requestTvFocus } from "../focus";
import { restoreFocus } from "../focusRestoration";

export type VideoActionOptions = {
  onRemove?: () => Promise<void>;
};

type Props = {
  api: YtZeroApi;
  actionConfig: VideoCardActionConfig;
  onClose: () => void;
  onOpenChannel: (channelId: string) => void;
  onRemove?: () => Promise<void>;
  onVideoChange: (video: Video) => void;
  preserveMenuKey: boolean;
  t: Translate;
  video: Video | null;
};

export function TvVideoActionMenu(props: Props) {
  return props.video ? <VideoActionMenu key={props.video.video_id} {...props} video={props.video} /> : null;
}

function VideoActionMenu({ api, actionConfig, onClose, onOpenChannel, onRemove, onVideoChange, preserveMenuKey, t, video }: Props & { video: Video }) {
  const { height, fontScale } = useScreenSize();
  const {
    view, currentVideo, playlists, busy, error, verified, metadataError, queued, queueFull,
    mainItems, close, goBack, selectAction, chooseSchedule, togglePlaylist, actionLabel, retryMetadata,
  } = useVideoActions({ api, actionConfig, video, onClose, onRemove, onVideoChange, t });
  const verifiedId = verified ? currentVideo.video_id : null;
  const [shown, setShown] = useState(false);
  const [firstTarget, setFirstTarget] = useState<View | null>(null);
  const [closeTarget, setCloseTarget] = useState<View | null>(null);
  const [focusedView, setFocusedView] = useState<VideoActionView | null>(null);
  // Each submenu takes focus again when it opens.
  useEffect(() => { setFocusedView(null); }, [view]);

  useTvModalBack(true, goBack, preserveMenuKey);
  const scheduleItems = scheduleBuckets.map(({ bucket }) => bucket);
  const firstAction = mainItems.find((item) => item !== "sessionQueue" || !queueFull);
  const empty = (view === "playlists" && playlists?.length === 0)
    || (view === "actions" && verifiedId === currentVideo.video_id && !firstAction);
  const entryTarget = empty ? closeTarget : firstTarget;
  useEffect(() => {
    if (!shown || !entryTarget || focusedView === view) return;
    return restoreFocus(() => entryTarget, requestTvFocus);
  }, [shown, entryTarget, view, focusedView]);
  // Keep the sheet stable across submenus while fitting the available actions.
  const panelHeight = Math.min(height - 120, Math.max(520, (168 + mainItems.length * 70) * Math.max(1, fontScale)));

  return (
    <Modal animationType="none" onRequestClose={goBack} onShow={() => setShown(true)} transparent visible>
      <PhoneOverlayScale>
      <TvFocusScope style={styles.fill}>
      <TVFocusGuideView accessibilityViewIsModal autoFocus destinations={entryTarget ? [entryTarget] : undefined} trapFocusDown trapFocusLeft trapFocusRight trapFocusUp style={styles.overlay}>
        <TvScreenTransition surface="glass" radius={36} style={[styles.panel, { height: panelHeight }]}>
          <View style={styles.videoSummary}>
            <View style={styles.thumbnailFrame}>
              {currentVideo.thumbnail ? <Image source={api.thumbnailSource(currentVideo.thumbnail)} resizeMode="cover" style={styles.thumbnail} /> : null}
              {formatVideoDuration(currentVideo.duration) ? <View style={styles.duration}><Text style={styles.durationText}>{formatVideoDuration(currentVideo.duration)}</Text></View> : null}
            </View>
            <Text numberOfLines={3} style={styles.videoTitle}>{currentVideo.title}</Text>
            <Text numberOfLines={1} style={styles.channel}>{currentVideo.channel_title}</Text>
          </View>

          <View style={styles.menuPanel}>
            <View style={styles.menuHeading}><Text accessibilityRole="header" style={styles.eyebrow}>{view === "actions" ? t("videoActions") : view === "schedule" ? t("scheduleVideo") : t("addToPlaylist")}</Text><TvCloseButton ref={setCloseTarget} t={t} variant="ghost" focusable={focusedView === view || empty} disabled={busy !== null} onPress={close} /></View>
            <View style={styles.choices} onFocus={() => setFocusedView(view)}>
            {verifiedId !== currentVideo.video_id ? <View style={styles.loading}>
              {metadataError ? <><Text style={styles.error}>{t("videoLoadError")}</Text><TvButton ref={setFirstTarget} label={t("tryAgain")} onPress={() => { setFocusedView(null); retryMetadata(); }} /></>
                : <TvLoadingMark accessibilityLabel={t("loadingVideo")} />}
            </View> : view === "actions" ? (
              <FlatList
                key="actions"
                data={mainItems}
                contentContainerStyle={styles.actionList}
                keyExtractor={(item) => item}
                renderItem={({ item }) => item === "channel" ? (
                  <TvListButton
                    ref={item === firstAction ? setFirstTarget : undefined}
                    deferPress
                    surface="filled"
                    label={t("goToChannel")}
                    hasTVPreferredFocus
                    accessibilityState={{ busy: busy !== null }}
                    onPress={() => {
                      if (busy) return;
                      onClose();
                      onOpenChannel(currentVideo.channel_id!);
                    }}
                  />
                ) : (
                  <TvListButton
                    ref={item === firstAction ? setFirstTarget : undefined}
                    deferPress={item === "sessionQueue" || item === "schedule" || item === "playlist"}
                    surface="filled"
                    label={actionLabel(item)}
                    hasTVPreferredFocus={item === firstAction}
                    indicator={item === "schedule" || item === "playlist" ? "chevron" : null}
                    destructive={item === "archive" || item === "remove"}
                    accessibilityState={{ busy: busy === item }}
                    disabled={item === "sessionQueue" && queueFull}
                    onPress={() => selectAction(item)}
                  />
                )}
                ItemSeparatorComponent={() => <View style={styles.actionSeparator} />}
                {...tvVerticalListPerformance}
              />
            ) : view === "schedule" ? (
              <FlatList
                key="schedule"
                data={scheduleItems}
                contentContainerStyle={styles.actionList}
                keyExtractor={(item) => item}
                renderItem={({ item, index }) => {
                  const option = scheduleBuckets.find(({ bucket }) => bucket === item)!;
                  const selected = currentVideo.status === "queued" && currentVideo.bucket === item;
                  return (
                    <TvListButton
                      ref={index === 0 ? setFirstTarget : undefined}
                      surface="filled"
                      label={t(option.label)}
                      detail={selected ? t("removeSchedule") : undefined}
                      indicator={selected ? "check" : null}
                      accessibilityState={{ selected, busy: busy === `schedule-${item}` }}
                      hasTVPreferredFocus={index === 0}
                      onPress={() => chooseSchedule(item)}
                    />
                  );
                }}
                ItemSeparatorComponent={() => <View style={styles.actionSeparator} />}
                {...tvVerticalListPerformance}
              />
            ) : playlists === null ? (
              <View style={styles.loading}>
                <TvLoadingMark accessibilityLabel={t("loadingPlaylists")} />
              </View>
            ) : playlists.length === 0 ? (
              <TvEmptyState compact icon="playlists" title={t("playlistsEmpty")} />
            ) : (
              <FlatList
                key="playlists"
                data={playlists}
                contentContainerStyle={styles.playlistList}
                keyExtractor={(playlist) => String(playlist.id)}
                renderItem={({ item, index }) => (
                  <TvListButton
                    ref={index === 0 ? setFirstTarget : undefined}
                    surface="filled"
                    label={item.name}
                    onPress={() => togglePlaylist(item, item.has_video !== 1)}
                    hasTVPreferredFocus={index === 0}
                    indicator={item.has_video === 1 ? "check" : null}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: item.has_video === 1, busy: busy === `playlist-${item.id}` }}
                  />
                )}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                {...tvVerticalListPerformance}
              />
            )}
            </View>
            {busy ? <View style={styles.busy}><TvLoadingMark accessibilityLabel={t("savingAction")} size={28} /></View> : null}
            {error ? <Text style={styles.error}>{t("actionFailed")}</Text> : null}
          </View>
        </TvScreenTransition>
      </TVFocusGuideView>
      </TvFocusScope>
    </PhoneOverlayScale></Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { flex: 1, backgroundColor: colors.modalScrim, alignItems: "center", justifyContent: "center", padding: 60 },
  panel: { flex: 0, width: "88%", maxWidth: 1200, padding: 32, borderRadius: 36, flexDirection: "row", gap: 20 },
  videoSummary: { width: "38%", paddingTop: 8 },
  thumbnailFrame: { width: "100%", aspectRatio: 16 / 9, borderRadius: 24, overflow: "hidden", backgroundColor: colors.surfaceRaised },
  thumbnail: { width: "100%", height: "100%", backgroundColor: colors.surfaceRaised },
  duration: { position: "absolute", right: 12, bottom: 12, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, backgroundColor: "rgba(0,0,0,0.8)" },
  durationText: { color: colors.white, fontSize: typography.caption.fontSize, fontWeight: "800" },
  videoTitle: { color: colors.text, fontSize: 28, lineHeight: 35, fontWeight: "800", marginTop: 22 },
  channel: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, marginTop: 9 },
  menuPanel: { flex: 1, minWidth: 0, minHeight: 0 },
  menuHeading: { flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 38, paddingRight: 12, marginBottom: 16 },
  eyebrow: { color: colors.text, fontSize: 30, lineHeight: 38, fontWeight: "700", flex: 1 },
  choices: { flex: 1, minHeight: 0 },
  actionList: { paddingHorizontal: 12, paddingVertical: 10 },
  actionSeparator: { height: 4 },
  loading: { minHeight: 360, alignItems: "center", justifyContent: "center", gap: 24 },
  empty: { minHeight: 340, alignItems: "center", justifyContent: "center", gap: 22 },
  emptyText: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, textAlign: "center" },
  playlistList: { paddingHorizontal: 12, paddingVertical: 10 },
  separator: { height: 4 },
  busy: { position: "absolute", top: 5, right: 4 },
  error: { color: colors.danger, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "700", marginTop: 14 },
});
