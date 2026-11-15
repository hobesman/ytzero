import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { deviceLanguage, localeTags, type Translate } from "../i18n";
import { PhoneChip } from "../phone/PhoneChip";
import { PhoneListRow, PhoneSectionTitle } from "../phone/PhoneList";
import { phoneColors, phoneType } from "../phone/phoneTheme";
import { formatBytes } from "../phoneDownloads";
import { albumDetail } from "./MusicAlbumCard";
import type { MusicAlbum, MusicAlbumPage, MusicApi, MusicPlaylistPage, MusicTrack } from "./musicApi";
import {
  musicCollectionProgress, musicDownloadBytes, musicDownloadCollection, musicDownloadCollections, musicDownloadedSingles, musicDownloadTrack,
  musicTrackProgress, type MusicCollectionKind, type MusicDownloadCollection, type MusicDownloadProgress, type MusicDownloadsView,
} from "./musicDownloads";
import type { MusicPage } from "./MusicPages";
import type { MusicSession } from "./musicSession";
import { MusicArtwork, MusicTrackRow } from "./MusicTrackRow";

const TILE = 140;
import { musicDownloads, useMusicDownloads } from "./useMusicDownloads";

/** A download's glyph: an arrow, a ring filling as it downloads, or a filled check once saved. */
export function MusicDownloadGlyph({ progress, color, size = 18 }: { progress: MusicDownloadProgress; color: string; size?: number }) {
  const stroke = { stroke: color, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (progress.state === "done") {
    return <Svg width={size} height={size} viewBox="0 0 24 24"><Circle cx="12" cy="12" r="9" fill={color} />
      <Path d="m8 12.5 2.8 2.8L16.5 9.5" stroke={phoneColors.background} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" /></Svg>;
  }
  if (progress.state === "active") {
    const circumference = 2 * Math.PI * 9;
    const fraction = progress.fraction ?? 0.08;
    return <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="9" stroke={phoneColors.surfaceRaised} strokeWidth={2.4} fill="none" />
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={2.4} fill="none" strokeLinecap="round"
        strokeDasharray={`${circumference * fraction} ${circumference}`} transform="rotate(-90 12 12)" />
    </Svg>;
  }
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" {...stroke} /></Svg>;
}

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

/** A song's mark in a list once it is saved on the phone, or while it downloads. */
export function MusicTrackDownloadMark({ videoId }: { videoId: string }) {
  const view = useMusicDownloads();
  const progress = musicTrackProgress(musicDownloadTrack(view, videoId));
  if (progress.state !== "done" && progress.state !== "active") return null;
  return <MusicDownloadGlyph progress={progress} color={progress.state === "done" ? phoneColors.accent : phoneColors.textMuted} size={16} />;
}

/** The song menu's row: Download, or Remove download once it is saved (or being saved) on its own. */
export function useMusicTrackDownloadAction(track: MusicTrack | null, t: Translate): { label: string; run: () => void } | null {
  const view = useMusicDownloads();
  if (!track || !view.available) return null;
  const item = musicDownloadTrack(view, track.videoId);
  if (item?.single && item.state !== "failed") {
    return { label: t("musicRemoveDownload"), run: () => confirmRemove(track.title, t, () => void musicDownloads.removeTrack(track.videoId)) };
  }
  return { label: t("musicDownload"), run: () => void musicDownloads.downloadTrack(track) };
}

/** An album or playlist page's Download button, showing how far its download got. */
export function MusicCollectionDownloadButton({ kind, page, t }: { kind: MusicCollectionKind; page: MusicAlbumPage | MusicPlaylistPage; t: Translate }) {
  const view = useMusicDownloads();
  if (!view.available || !page.tracks.length) return null;
  const id = "browseId" in page ? page.browseId : page.playlistId;
  const progress = musicCollectionProgress(view, musicDownloadCollection(view, kind, id));
  const download = () => void (kind === "album" ? musicDownloads.downloadAlbum(page as MusicAlbumPage) : musicDownloads.downloadPlaylist(page as MusicPlaylistPage));
  const press = progress.state === "none" || progress.state === "failed" ? download
    : () => confirmRemove(page.title, t, () => void musicDownloads.removeCollection(kind, id));
  return <View style={styles.button}>
    <MusicDownloadGlyph progress={progress} color={progress.state === "done" ? phoneColors.accent : phoneColors.text} />
    <PhoneChip label={progressLabel(progress, view.waiting, t)} onPress={press} />
  </View>;
}

function collectionAlbum(entry: MusicDownloadCollection): MusicAlbum {
  return entry.album ?? { browseId: entry.id, title: entry.title, artist: entry.subtitle, artistId: null, year: null, thumbnail: entry.thumbnail, kind: "album" };
}

/**
 * Library → Downloads: the albums, playlists and songs saved on this phone,
 * the space they use and the Wi-Fi-only choice. Long-press removes one.
 */
export function MusicDownloadsSection({ api, session, t, playingId, onOpen }: {
  api: MusicApi; session: MusicSession; t: Translate; playingId: string | null; onOpen: (page: MusicPage) => void;
}) {
  const view = useMusicDownloads();
  const [free, setFree] = useState<number | null>(null);
  const collections = musicDownloadCollections(view);
  const singles = musicDownloadedSingles(view);
  const used = musicDownloadBytes(view);
  useEffect(() => { void musicDownloads.freeBytes().then(setFree); }, [used]);
  if (!view.available) return null;
  const locale = localeTags[deviceLanguage()];
  const any = collections.length > 0 || singles.length > 0;
  const deleteAll = () => Alert.alert(t("deleteAllDownloads"), t("musicDeleteAllDownloadsConfirm"), [
    { text: t("cancel"), style: "cancel" },
    { text: t("deleteAllDownloads"), style: "destructive", onPress: () => void musicDownloads.removeAll() },
  ]);
  const openCollection = (entry: MusicDownloadCollection) => onOpen(entry.kind === "album" ? { kind: "album", id: entry.id } : { kind: "playlist", id: entry.id });
  const playSingle = (track: MusicTrack) => void session.start({ kind: "track", videoId: track.videoId });
  const removeSingle = (track: MusicTrack) => confirmRemove(track.title, t, () => void musicDownloads.removeTrack(track.videoId));
  return <View>
    <PhoneSectionTitle title={t("musicDownloads")} />
    {any ? <View style={styles.summary}>
      <Text style={styles.storage}>{t("downloadsStorage").replace("{used}", formatBytes(used, locale)).replace("{free}", free === null ? "–" : formatBytes(free, locale))}</Text>
      <PhoneChip label={t("deleteAllDownloads")} onPress={deleteAll} />
    </View> : <Text style={styles.empty}>{t("musicDownloadsEmpty")}</Text>}
    {collections.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
      {collections.map((entry) => {
        const progress = musicCollectionProgress(view, entry);
        const album = collectionAlbum(entry);
        const detail = progress.state !== "done" ? progressLabel(progress, view.waiting, t)
          : entry.kind === "album" ? albumDetail(album, t, true) : t("musicDownloadSongCount").replace("{count}", String(progress.count));
        return <Pressable key={`${entry.kind}:${entry.id}`} accessibilityRole="button" accessibilityLabel={`${entry.title}, ${detail}`}
          onPress={() => openCollection(entry)} onLongPress={() => confirmRemove(entry.title, t, () => void musicDownloads.removeCollection(entry.kind, entry.id))}
          style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
          <MusicArtwork api={api} url={entry.thumbnail} size={TILE} radius={8} />
          <Text numberOfLines={2} style={styles.tileTitle}>{entry.title}</Text>
          <Text numberOfLines={1} style={styles.tileDetail}>{detail}</Text>
        </Pressable>;
      })}
    </ScrollView> : null}
    {singles.map((item) => <View key={item.videoId} style={styles.single}>
      <View style={styles.singleRow}><MusicTrackRow api={api} track={item.track} active={item.videoId === playingId} onPress={playSingle} onLongPress={removeSingle} /></View>
      {item.state !== "done" ? <View style={styles.singleMark}><MusicDownloadGlyph progress={musicTrackProgress(item)} color={phoneColors.textMuted} size={16} /></View> : null}
    </View>)}
    <PhoneListRow title={t("musicDownloadWifiOnly")} detail={t("musicDownloadWifiOnlyHint")} trailing={<Switch value={view.index.wifiOnly}
      onValueChange={(value) => musicDownloads.setWifiOnly(value)} trackColor={{ true: phoneColors.accent, false: phoneColors.surfaceRaised }} thumbColor={phoneColors.text} />} />
  </View>;
}

/** Shown at the top of music mode while the server can't be reached. */
export function MusicOfflineNotice({ t }: { t: Translate }) {
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
  single: { flexDirection: "row", alignItems: "center" },
  singleRow: { flex: 1 },
  singleMark: { paddingRight: 16 },
  offline: { ...phoneType.caption, color: phoneColors.text, backgroundColor: phoneColors.surfaceRaised, textAlign: "center", paddingVertical: 6 },
});
