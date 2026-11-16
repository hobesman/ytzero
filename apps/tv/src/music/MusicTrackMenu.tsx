import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, Share, StyleSheet, Text, View } from "react-native";
import type { Translate } from "../i18n";
import { shareMessage, youtubeMusicUrl } from "../shareLinks";
import { phoneColors, phoneType } from "../phone/phoneTheme";
import type { MusicApi, MusicTrack } from "./musicApi";
import { MusicDownloadGlyph } from "./MusicDownloadMark";
import { useMusicTrackDownloadAction } from "./MusicDownloadViews";
import { MusicIcon, type MusicIconName } from "./MusicIcon";
import type { MusicSession } from "./musicSession";
import { MusicArtwork } from "./MusicTrackRow";
import { MusicTrackMenuContext, type MusicTrackMenuExtras, type OpenMusicTrackMenu } from "./musicTrackMenuContext";

/** Hosts the one song menu music mode shows, so every list can open it. */
export function MusicTrackMenuProvider({ api, session, t, onNotice, children }: {
  api: MusicApi; session: MusicSession; t: Translate; onNotice: (text: string) => void; children: ReactNode;
}) {
  const [open, setOpen] = useState<{ track: MusicTrack; extras: MusicTrackMenuExtras } | null>(null);
  const show = useCallback<OpenMusicTrackMenu>((track, extras = {}) => setOpen({ track, extras }), []);
  const menu = useMemo(() => ({ open: show, label: t("musicMoreOptions") }), [show, t]);
  const close = () => setOpen(null);
  // Download or Remove download, on phones that keep music for offline listening.
  const download = useMusicTrackDownloadAction(open?.track ?? null, t);
  const rows = useMemo(() => {
    if (!open) return [];
    const { track, extras } = open;
    // With nothing playing the song simply starts, so there is nothing to announce.
    const queue = (placement: "next" | "last", notice: string) => () => {
      if (session.snapshot().queue) onNotice(notice);
      void session.enqueue(track, placement);
    };
    const list: { key: string; icon: MusicIconName | ReactNode; label: string; run: () => void }[] = [
      { key: "next", icon: "queueNext", label: t("musicPlayNext"), run: queue("next", t("musicQueuedNext")) },
      { key: "last", icon: "queueAdd", label: t("musicAddToQueue"), run: queue("last", t("musicQueuedLast")) },
    ];
    if (download) list.push({ key: "download", icon: <MusicDownloadGlyph progress={{ state: "none", fraction: null, done: 0, count: 1 }} color={phoneColors.text} size={22} />, ...download });
    // The music.youtube.com link: music mode's songs aren't in the profile's video library, so there's no YT Zero link for them.
    const link = youtubeMusicUrl(track.videoId);
    if (link) list.push({ key: "share", icon: "share", label: t("shareSong"),
      run: () => void Share.share({ message: shareMessage(track.title, link, track.artist) }).catch(() => {}) });
    if (extras.onRemove) list.push({ key: "remove", icon: "remove", label: t("musicRemoveFromQueue"), run: extras.onRemove });
    list.push({ key: "dislike", icon: "dislike", label: t("musicNotThis"), run: () => void session.dislike(track) });
    return list;
  }, [download, onNotice, open, session, t]);
  return <MusicTrackMenuContext.Provider value={menu}>
    {children}
    {open ? <Modal transparent visible animationType="fade" onRequestClose={close}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("close")} style={styles.scrim} onPress={close} />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <MusicArtwork api={api} url={open.track.thumbnail} size={44} />
          <View style={styles.copy}>
            <Text numberOfLines={1} style={styles.title}>{open.track.title}</Text>
            <Text numberOfLines={1} style={styles.detail}>{open.track.artist}</Text>
          </View>
        </View>
        {rows.map((row) => <Pressable key={row.key} accessibilityRole="button" accessibilityLabel={row.label}
          onPress={() => { close(); row.run(); }} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          {typeof row.icon === "string" ? <MusicIcon name={row.icon as MusicIconName} color={phoneColors.text} size={22} /> : row.icon}
          <Text style={styles.label}>{row.label}</Text>
        </Pressable>)}
      </View>
    </Modal> : null}
  </MusicTrackMenuContext.Provider>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { backgroundColor: phoneColors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 16, paddingTop: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: phoneColors.divider },
  copy: { flex: 1, gap: 2 },
  title: { ...phoneType.title, color: phoneColors.text },
  detail: { ...phoneType.caption, color: phoneColors.textMuted },
  row: { flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 20, paddingVertical: 14 },
  pressed: { backgroundColor: "rgba(255,255,255,0.08)" },
  label: { ...phoneType.body, fontSize: 15, color: phoneColors.text },
});
