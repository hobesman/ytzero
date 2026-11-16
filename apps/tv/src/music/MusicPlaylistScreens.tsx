import { memo, useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { TvChoiceSheet } from "../components/TvChoiceSheet";
import type { Translate } from "../i18n";
import { PhoneChip } from "../phone/PhoneChip";
import { PhoneTextSheet } from "../phone/PhoneTextSheet";
import { phoneColors, phoneType } from "../phone/phoneTheme";
import type { Language } from "../types";
import type { MusicApi, MusicTrack, MusicUserPlaylist, MusicUserPlaylistPage } from "./musicApi";
import { MusicCollectionDownloadButton } from "./MusicDownloadViews";
import { MusicIcon } from "./MusicIcon";
import { PageFrame, usePageData, type MusicPage, type PageProps } from "./MusicPages";
import { formatSongCount } from "./musicSongCount";
import { durationLabel, MusicArtwork, MusicTrackRow } from "./MusicTrackRow";

/** A page music mode can open: the shared ones, or one of the profile's own playlists. */
export type MusicAppPage = MusicPage | { kind: "mine"; id: string };

const TILE = 140;

/** One of the profile's playlists in a library shelf: its first song's artwork, its name and length. */
export const MusicUserPlaylistCard = memo(function MusicUserPlaylistCard({ api, playlist, language, onPress }: {
  api: MusicApi; playlist: MusicUserPlaylist; language: Language; onPress: (playlist: MusicUserPlaylist) => void;
}) {
  const detail = formatSongCount(playlist.trackCount, language);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${playlist.title}, ${detail}`} onPress={() => onPress(playlist)}
    style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
    <MusicArtwork api={api} url={playlist.thumbnail} size={TILE} radius={8} />
    <Text numberOfLines={2} style={styles.title}>{playlist.title}</Text>
    <Text numberOfLines={1} style={styles.detail}>{detail}</Text>
  </Pressable>;
});

/** The first tile of "Your playlists": makes a new one. */
export function MusicNewPlaylistCard({ t, onPress }: { t: Translate; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={t("musicNewPlaylist")} onPress={onPress}
    style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
    <View style={styles.newArt}><MusicIcon name="save" color={phoneColors.text} size={40} /></View>
    <Text numberOfLines={2} style={styles.title}>{t("musicNewPlaylist")}</Text>
  </Pressable>;
}

/** Asks for a new playlist's name and creates it; the playlist goes to `onCreated`. */
export function MusicNewPlaylistSheet({ api, t, onCreated, onClose }: {
  api: MusicApi; t: Translate; onCreated: (playlist: MusicUserPlaylist) => void | Promise<void>; onClose: () => void;
}) {
  return <PhoneTextSheet title={t("musicNewPlaylist")} label={t("musicPlaylistName")} saveLabel={t("musicCreate")} error={t("musicActionFailed")} t={t}
    onSave={async (name) => { await onCreated(await api.createPlaylist(name)); }} onClose={onClose} />;
}

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function EditButton({ label, icon, disabled, onPress }: { label: string; icon: "up" | "down" | "remove"; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} hitSlop={4}
    onPress={onPress} style={({ pressed }) => [styles.editButton, (pressed || disabled) && styles.dimmed]}>
    <MusicIcon name={icon} color={phoneColors.text} size={20} />
  </Pressable>;
}

/** A song in a playlist being edited: move it up or down, or take it out. */
function EditRow({ api, t, track, first, last, onMove, onRemove }: {
  api: MusicApi; t: Translate; track: MusicTrack; first: boolean; last: boolean; onMove: (by: -1 | 1) => void; onRemove: () => void;
}) {
  return <View style={styles.editRow}>
    <MusicArtwork api={api} url={track.thumbnail} size={40} />
    <View style={styles.editCopy}>
      <Text numberOfLines={1} style={styles.rowTitle}>{track.title}</Text>
      <Text numberOfLines={1} style={styles.detail}>{[track.artist, durationLabel(track.duration)].filter(Boolean).join(" · ")}</Text>
    </View>
    <EditButton label={t("musicMoveUp")} icon="up" disabled={first} onPress={() => onMove(-1)} />
    <EditButton label={t("musicMoveDown")} icon="down" disabled={last} onPress={() => onMove(1)} />
    <EditButton label={t("musicRemoveFromPlaylist")} icon="remove" onPress={onRemove} />
  </View>;
}

/** One of the profile's own playlists: play it, rename or delete it, and reorder or remove its songs. */
export function MusicUserPlaylistScreen({ api, session, t, language, playingId, id, onBack }: PageProps & { language: Language }) {
  const load = useCallback(() => api.myPlaylist(id), [api, id]);
  const { data: playlist, setData, failed, retry } = usePageData<MusicUserPlaylistPage>(load);
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const tracks = playlist?.tracks ?? [];
  const play = useCallback((options: { shuffle?: boolean; startAt?: string } = {}) => {
    if (playlist) void session.playTracks(playlist.tracks, { from: playlist.title, ...options });
  }, [playlist, session]);
  const startAt = useCallback((track: MusicTrack) => play({ startAt: track.videoId }), [play]);
  // Shown at once; a failed save reloads what the server has.
  const update = (next: MusicUserPlaylistPage, request: Promise<unknown>) => {
    setData(next);
    request.catch(() => { Alert.alert(t("musicActionFailed")); retry(); });
  };
  const move = (from: number, by: -1 | 1) => {
    if (!playlist) return;
    const order = moved(playlist.tracks, from, from + by);
    update({ ...playlist, tracks: order }, api.reorderPlaylist(playlist.id, order.map((track) => track.videoId)));
  };
  const remove = (track: MusicTrack) => {
    if (!playlist) return;
    update({ ...playlist, tracks: playlist.tracks.filter((entry) => entry.videoId !== track.videoId), trackCount: playlist.trackCount - 1 },
      api.removeFromPlaylist(playlist.id, track.videoId));
  };
  const confirmDelete = () => {
    if (!playlist) return;
    Alert.alert(t("musicDeletePlaylist"), t("musicDeletePlaylistConfirm").replace("{name}", playlist.title), [
      { text: t("cancel"), style: "cancel" },
      { text: t("musicDelete"), style: "destructive", onPress: () => { api.deletePlaylist(playlist.id).then(onBack, () => Alert.alert(t("musicActionFailed"))); } },
    ]);
  };
  useEffect(() => { if (!tracks.length) setEditing(false); }, [tracks.length]);
  const header = playlist ? <View>
    <View style={styles.header}>
      <MusicArtwork api={api} url={tracks[0]?.thumbnail ?? playlist.thumbnail} size={200} radius={10} />
      <Text style={styles.heading}>{playlist.title}</Text>
      <Text style={styles.subtitle}>{formatSongCount(tracks.length, language)}</Text>
      <View style={styles.actions}>
        <PhoneChip primary label={t("musicPlay")} disabled={!tracks.length} onPress={() => play()} />
        <PhoneChip label={t("musicShuffle")} disabled={tracks.length < 2} onPress={() => play({ shuffle: true })} />
        <PhoneChip label={t("musicRenamePlaylist")} onPress={() => setRenaming(true)} />
        {tracks.length ? <PhoneChip label={editing ? t("musicDoneEditing") : t("musicEditPlaylist")} onPress={() => setEditing(!editing)} /> : null}
        <PhoneChip label={t("musicDelete")} onPress={confirmDelete} />
      </View>
      <MusicCollectionDownloadButton kind="mine" page={playlist} t={t} />
    </View>
    {!tracks.length ? <Text style={styles.empty}>{t("musicPlaylistEmpty")}</Text> : null}
  </View> : null;
  return <PageFrame t={t} onBack={onBack} failed={failed && !playlist} failedText={t("musicPlaylistFailed")} loading={!playlist} onRetry={retry}>
    {playlist ? <FlatList data={tracks} keyExtractor={(track) => track.videoId} ListHeaderComponent={header} extraData={editing}
      renderItem={({ item, index }) => editing
        ? <EditRow api={api} t={t} track={item} first={index === 0} last={index === tracks.length - 1} onMove={(by) => move(index, by)} onRemove={() => remove(item)} />
        : <MusicTrackRow api={api} track={item} active={item.videoId === playingId} onPress={startAt} />} /> : null}
    {renaming && playlist ? <PhoneTextSheet title={t("musicRenamePlaylist")} label={t("musicPlaylistName")} value={playlist.title} saveLabel={t("save")}
      error={t("musicActionFailed")} t={t} onClose={() => setRenaming(false)}
      onSave={async (name) => { const { title } = await api.renamePlaylist(playlist.id, name); setData({ ...playlist, title }); setRenaming(false); }} /> : null}
  </PageFrame>;
}

/**
 * Adds a song to one of the profile's playlists, or to a new one. `onNotice`
 * says how it went; the sheet closes after any choice.
 */
export function MusicAddToPlaylistSheet({ api, t, track, onNotice, onClose }: {
  api: MusicApi; t: Translate; track: MusicTrack; onNotice: (text: string) => void; onClose: () => void;
}) {
  const [playlists, setPlaylists] = useState<MusicUserPlaylist[] | null>(null);
  const [naming, setNaming] = useState(false);
  useEffect(() => {
    let live = true;
    api.myPlaylists().then((list) => { if (live) setPlaylists(list); }, () => { if (live) setPlaylists([]); });
    return () => { live = false; };
  }, [api]);
  const add = async (playlist: MusicUserPlaylist) => {
    try {
      const { added } = await api.addToPlaylist(playlist.id, track.videoId);
      onNotice(t(added ? "musicAddedToPlaylist" : "musicAlreadyInPlaylist").replace("{name}", playlist.title));
    } catch { onNotice(t("musicActionFailed")); }
  };
  if (naming) return <MusicNewPlaylistSheet api={api} t={t} onClose={onClose} onCreated={async (playlist) => { onClose(); await add(playlist); }} />;
  const options = [{ value: "", label: `+ ${t("musicNewPlaylist")}` }, ...(playlists ?? []).map((playlist) => ({ value: playlist.id, label: playlist.title }))];
  return <TvChoiceSheet<string> title={t("musicAddToPlaylist")} t={t} value="\u0000" busy={playlists === null} options={options} onClose={onClose}
    onSelect={(value) => {
      if (!value) { setNaming(true); return; }
      const playlist = playlists?.find((entry) => entry.id === value);
      onClose();
      if (playlist) void add(playlist);
    }} />;
}

const styles = StyleSheet.create({
  tile: { width: TILE, gap: 4, borderRadius: 8 },
  pressed: { opacity: 0.7 },
  newArt: { width: TILE, height: TILE, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: phoneColors.surfaceRaised },
  title: { ...phoneType.title, fontSize: 14, color: phoneColors.text },
  detail: { ...phoneType.caption, color: phoneColors.textMuted },
  header: { alignItems: "center", gap: 6, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 },
  heading: { ...phoneType.heading, color: phoneColors.text, textAlign: "center", marginTop: 8 },
  subtitle: { ...phoneType.caption, color: phoneColors.textMuted },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 10 },
  empty: { ...phoneType.body, color: phoneColors.textMuted, textAlign: "center", padding: 32 },
  editRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 6 },
  editCopy: { flex: 1, gap: 2 },
  rowTitle: { ...phoneType.title, color: phoneColors.text },
  editButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: phoneColors.surfaceRaised },
  dimmed: { opacity: 0.4 },
});
