import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { localeTags, type Translate } from "../i18n";
import { PhoneChip } from "../phone/PhoneChip";
import { PhoneListRow, PhoneSectionTitle } from "../phone/PhoneList";
import { phoneColors, phoneType } from "../phone/phoneTheme";
import { formatBytes } from "../phoneDownloads";
import type { Language } from "../types";
import { albumDetail } from "./MusicAlbumCard";
import type { MusicAlbum, MusicAlbumPage, MusicApi, MusicPlaylistPage, MusicTrack, MusicUserPlaylistPage } from "./musicApi";
import { MusicDownloadGlyph } from "./MusicDownloadMark";
import {
  musicCollectionProgress, musicDownloadBytes, musicDownloadCollection, musicDownloadCollections, musicDownloadedSingles, musicDownloadTrack,
  type MusicCollectionKind, type MusicDownloadCollection, type MusicDownloadProgress, type MusicDownloadsView,
} from "./musicDownloads";
import type { MusicAppPage } from "./MusicPlaylistScreens";
import type { MusicSession } from "./musicSession";
import { MusicArtwork, MusicTrackRow } from "./MusicTrackRow";
import { musicDownloads, useMusicDownloads } from "./useMusicDownloads";

const TILE = 140;

function progressLabel(progress: MusicDownloadProgress, waiting: MusicDownloadsView["waiting"], t: Translate): string {
  if (progress.state === "done") return t("musicDownloaded");
  if (progress.state === "failed") return t("musicDownloadFailed");
  if (progress.state === "none") return t("musicDownload");
  if (waiting === "wifi") return t("downloadWaitingWifi");
  if (waiting === "network") return t("downloadWaitingNetwork");
  return progress.count > 1 ? t("musicDownloadingCount").replace("{done}", String(progress.done)).replace("{count}", String(progress.count)) : t("musicDownloading");
}

function confirmRemove(title: string, t: Translate, remove: () => void) {
  Alert.alert(t("musicRemoveDownload"), t("musicDeleteDownloadConfirm").replace("{title}", title), [
    { text: t("cancel"), style: "cancel" },
    { text: t("deleteDownload"), style: "destructive", onPress: remove },
  ]);
}

/** The song menu's row: Download, or Remove download once it is saved (or being saved) on its own. */
export function useMusicTrackDownloadAction(track: MusicTrack | null, t: Translate): { label: string; run: () => void } | null {
  const view = useMusicDownloads();
  if (!track || !view.available) return null;
  const item = musicDownloadTrack(view, track.videoId);
  if (item?.single && item.state !== "failed") {
    return { label: t("musicRemoveDownload"), run: () => confirmRemove(track.title, t, () => void musicDownloads.removeTrack(track.videoId)) };
  }
  // Part of a downloaded album or playlist already: nothing to add.
  if (item?.state === "done") return null;
  return { label: t("musicDownload"), run: () => void musicDownloads.downloadTrack(track) };
}

type CollectionButtonProps =
  | { kind: "album"; page: MusicAlbumPage } | { kind: "playlist"; page: MusicPlaylistPage } | { kind: "mine"; page: MusicUserPlaylistPage };

/** An album or playlist page's Download button, showing how far its download got. */
export function MusicCollectionDownloadButton({ t, ...props }: CollectionButtonProps & { t: Translate }) {
  const view = useMusicDownloads();
  if (!view.available || !props.page.tracks.length) return null;
  const id = props.kind === "album" ? props.page.browseId : props.kind === "playlist" ? props.page.playlistId : props.page.id;
  const progress = musicCollectionProgress(view, musicDownloadCollection(view, props.kind, id));
  const download = () => void (props.kind === "album" ? musicDownloads.downloadAlbum(props.page)
    : props.kind === "playlist" ? musicDownloads.downloadPlaylist(props.page) : musicDownloads.downloadMyPlaylist(props.page));
  const press = progress.state === "none" || progress.state === "failed" ? download
    : () => confirmRemove(props.page.title, t, () => void musicDownloads.removeCollection(props.kind, id));
  return <View style={styles.button}>
    <MusicDownloadGlyph progress={progress} color={progress.state === "done" ? phoneColors.accent : phoneColors.text} />
    <PhoneChip label={progressLabel(progress, view.waiting, t)} onPress={press} />
  </View>;
}

function collectionAlbum(entry: MusicDownloadCollection): MusicAlbum {
  return entry.album ?? { browseId: entry.id, title: entry.title, artist: entry.subtitle, artistId: null, year: null, thumbnail: entry.thumbnail, kind: "album" };
}

function collectionPage(entry: MusicDownloadCollection): MusicAppPage {
  return entry.kind === "album" ? { kind: "album", id: entry.id } : entry.kind === "mine" ? { kind: "mine", id: entry.id } : { kind: "playlist", id: entry.id };
}

/**
 * Library → Downloads: the albums, playlists and songs saved on this phone,
 * the space they use and the Wi-Fi-only choice. Long-press an album or
 * playlist to remove it; a song is removed from its menu.
 */
export function MusicDownloadsSection({ api, session, t, language, playingId, onOpen }: {
  api: MusicApi; session: MusicSession; t: Translate; language: Language; playingId: string | null; onOpen: (page: MusicAppPage) => void;
}) {
  const view = useMusicDownloads();
  const [free, setFree] = useState<number | null>(null);
  const collections = musicDownloadCollections(view);
  const singles = musicDownloadedSingles(view);
  const used = musicDownloadBytes(view);
  useEffect(() => { void musicDownloads.freeBytes().then(setFree); }, [used]);
  if (!view.available) return null;
  const locale = localeTags[language];
  const any = collections.length > 0 || singles.length > 0;
  const deleteAll = () => Alert.alert(t("deleteAllDownloads"), t("musicDeleteAllDownloadsConfirm"), [
    { text: t("cancel"), style: "cancel" },
    { text: t("deleteAllDownloads"), style: "destructive", onPress: () => void musicDownloads.removeAll() },
  ]);
  const playSingle = (track: MusicTrack) => void session.start({ kind: "track", videoId: track.videoId });
  return <View>
    <PhoneSectionTitle title={t("musicDownloads")} />
    {any ? <View style={styles.summary}>
      <Text style={styles.storage}>{t("downloadsStorage").replace("{used}", formatBytes(used, locale)).replace("{free}", free === null ? "–" : formatBytes(free, locale))}</Text>
      <PhoneChip label={t("deleteAllDownloads")} onPress={deleteAll} />
    </View> : <Text style={styles.empty}>{t("musicDownloadsEmpty")}</Text>}
    {collections.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
      {collections.map((entry) => {
        const progress = musicCollectionProgress(view, entry);
        const detail = progress.state !== "done" ? progressLabel(progress, view.waiting, t)
          : entry.kind === "album" ? albumDetail(collectionAlbum(entry), t, true) : t("musicDownloadSongCount").replace("{count}", String(progress.count));
        return <Pressable key={`${entry.kind}:${entry.id}`} accessibilityRole="button" accessibilityLabel={`${entry.title}, ${detail}`}
          onPress={() => onOpen(collectionPage(entry))} onLongPress={() => confirmRemove(entry.title, t, () => void musicDownloads.removeCollection(entry.kind, entry.id))}
          style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
          <MusicArtwork api={api} url={entry.thumbnail} size={TILE} radius={8} />
          <Text numberOfLines={2} style={styles.tileTitle}>{entry.title}</Text>
          <Text numberOfLines={1} style={styles.tileDetail}>{detail}</Text>
        </Pressable>;
      })}
    </ScrollView> : null}
    {singles.map((item) => <MusicTrackRow key={item.videoId} api={api} track={item.track} active={item.videoId === playingId} onPress={playSingle} />)}
    <MusicDownloadWifiSetting t={t} />
  </View>;
}

/** Whether songs wait for Wi-Fi to download; in the Library's downloads and in Settings. */
export function MusicDownloadWifiSetting({ t }: { t: Translate }) {
  const view = useMusicDownloads();
  if (!musicDownloads.available) return null;
  return <PhoneListRow title={t("musicDownloadWifiOnly")} detail={t("musicDownloadWifiOnlyHint")} trailing={<Switch value={view.index.wifiOnly}
    onValueChange={(value) => musicDownloads.setWifiOnly(value)} trackColor={{ true: phoneColors.accent, false: phoneColors.surfaceRaised }} thumbColor={phoneColors.text} />} />;
}

/** Shown at the top of music mode while the server can't be reached. */
export function MusicOfflineNotice({ t }: { t: Translate }) {
  const view = useMusicDownloads();
  if (!view.offline) return null;
  return <Text accessibilityLiveRegion="polite" style={styles.offline}>{t("musicOffline")}</Text>;
}

const styles = StyleSheet.create({
  shelf: { gap: 12, paddingHorizontal: 16, paddingBottom: 4 },
  tile: { width: TILE, gap: 4, borderRadius: 8 },
  pressed: { opacity: 0.7 },
  tileTitle: { ...phoneType.title, fontSize: 14, color: phoneColors.text },
  tileDetail: { ...phoneType.caption, color: phoneColors.textMuted },
  button: { flexDirection: "row", alignItems: "center", gap: 8 },
  summary: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  storage: { flex: 1, ...phoneType.body, color: phoneColors.textMuted },
  empty: { ...phoneType.body, color: phoneColors.textMuted, paddingHorizontal: 16, paddingBottom: 8 },
  offline: { ...phoneType.caption, color: phoneColors.text, backgroundColor: phoneColors.surfaceRaised, textAlign: "center", paddingVertical: 6 },
});
