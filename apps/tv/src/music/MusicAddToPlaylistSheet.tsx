import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Translate } from "../i18n";
import { PhoneListRow } from "../phone/PhoneList";
import { phoneColors, phoneType } from "../phone/phoneTheme";
import type { Language } from "../types";
import type { MusicApi, MusicTrack, MusicUserPlaylist } from "./musicApi";
import { MusicIcon } from "./MusicIcon";
import { playlistAddNotice } from "./musicPlaylistAdd";
import { MusicNewPlaylistSheet } from "./MusicPlaylistScreens";
import { formatSongCount } from "./musicSongCount";
import { MusicArtwork } from "./MusicTrackRow";

/** What is being added: one song, or an album's or a playlist's songs. `excludeId` is the playlist they come from, left off the list. */
export type MusicPlaylistAddition = { tracks: MusicTrack[]; excludeId?: string };

/**
 * Adds songs to one of the profile's playlists, or to a new one, from a
 * bottom sheet with large rows. `onNotice` says how it went; the sheet
 * closes after any choice.
 */
export function MusicAddToPlaylistSheet({ api, t, language, addition, onNotice, onClose }: {
  api: MusicApi; t: Translate; language: Language; addition: MusicPlaylistAddition; onNotice: (text: string) => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { tracks, excludeId } = addition;
  const [playlists, setPlaylists] = useState<MusicUserPlaylist[] | null>(null);
  const [naming, setNaming] = useState(false);
  useEffect(() => {
    let live = true;
    api.myPlaylists().then((list) => { if (live) setPlaylists(list); }, () => { if (live) setPlaylists([]); });
    return () => { live = false; };
  }, [api]);
  const add = async (playlist: MusicUserPlaylist) => {
    try {
      if (tracks.length === 1) {
        const { added } = await api.addToPlaylist(playlist.id, tracks[0]!.videoId);
        onNotice(t(added ? "musicAddedToPlaylist" : "musicAlreadyInPlaylist").replace("{name}", playlist.title));
        return;
      }
      const result = await api.addManyToPlaylist(playlist.id, tracks.map((track) => track.videoId));
      onNotice(playlistAddNotice(result, playlist.title, t, (count) => formatSongCount(count, language)));
    } catch { onNotice(t("musicActionFailed")); }
  };
  if (naming) return <MusicNewPlaylistSheet api={api} t={t} onClose={onClose} onCreated={async (playlist) => { onClose(); await add(playlist); }} />;
  const choices = playlists?.filter((playlist) => playlist.id !== excludeId) ?? null;
  const what = tracks.length === 1 ? tracks[0]!.title : formatSongCount(tracks.length, language);
  return <Modal transparent visible animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <Pressable accessibilityRole="button" accessibilityLabel={t("close")} style={styles.scrim} onPress={onClose} />
    <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.handle} />
      <View style={styles.header}>
        <Text style={styles.title}>{t("musicAddToPlaylist")}</Text>
        <Text numberOfLines={1} style={styles.detail}>{what}</Text>
      </View>
      <ScrollView style={styles.list}>
        <PhoneListRow icon={<View style={styles.newArt}><MusicIcon name="save" color={phoneColors.text} size={26} /></View>}
          title={t("musicNewPlaylist")} onPress={() => setNaming(true)} />
        {choices === null ? <ActivityIndicator style={styles.loading} color={phoneColors.textMuted} />
          : choices.map((playlist) => <PhoneListRow key={playlist.id} icon={<MusicArtwork api={api} url={playlist.thumbnail} size={ART} />}
            title={playlist.title} detail={formatSongCount(playlist.trackCount, language)} onPress={() => { onClose(); void add(playlist); }} />)}
      </ScrollView>
    </View>
  </Modal>;
}

const ART = 48;

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { maxHeight: "75%", backgroundColor: phoneColors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8 },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: phoneColors.surfaceRaised, marginBottom: 8 },
  header: { gap: 2, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: phoneColors.divider },
  title: { ...phoneType.title, color: phoneColors.text },
  detail: { ...phoneType.caption, color: phoneColors.textMuted },
  list: { flexGrow: 0 },
  newArt: { width: ART, height: ART, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: phoneColors.surfaceRaised },
  loading: { padding: 24 },
});
