import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { Translate } from "../i18n";
import { PhoneChip } from "../phone/PhoneChip";
import { PhoneSectionTitle } from "../phone/PhoneList";
import { phoneColors, phoneType } from "../phone/phoneTheme";
import { albumDetail, MusicAlbumCard, MusicShelf } from "./MusicAlbumCard";
import type { MusicAlbum, MusicAlbumPage, MusicApi, MusicArtistPage, MusicTrack } from "./musicApi";
import { MusicIcon } from "./MusicIcon";
import type { MusicSession } from "./musicSession";
import { durationLabel, MusicArtwork, MusicTrackRow } from "./MusicTrackRow";

/** A page opened from a list, drawn over the current tab. */
export type MusicPage = { kind: "album"; id: string } | { kind: "artist"; id: string };

type PageProps = {
  api: MusicApi; session: MusicSession; t: Translate; playingId: string | null; id: string;
  onOpen: (page: MusicPage) => void; onBack: () => void;
};

/** Loads a page's data, with a retry when it fails. */
function usePageData<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const run = useCallback(() => {
    let live = true;
    setFailed(false);
    load().then((value) => { if (live) setData(value); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [load]);
  useEffect(run, [run]);
  return { data, setData, failed, retry: run };
}

function PageFrame({ t, onBack, failed, failedText, loading, onRetry, children }: {
  t: Translate; onBack: () => void; failed: boolean; failedText: string; loading: boolean; onRetry: () => void; children: ReactNode;
}) {
  // The back button comes last so it draws over the page without a zIndex: on
  // Android a zIndex outlives view flattening and lifts it over Now playing too.
  return <View style={styles.page}>
    {failed ? <View style={styles.note}>
      <Text style={styles.noteText}>{failedText}</Text>
      <PhoneChip label={t("musicRetry")} onPress={onRetry} />
    </View> : loading ? <ActivityIndicator style={styles.loading} color={phoneColors.textMuted} /> : children}
    <Pressable accessibilityRole="button" accessibilityLabel={t("back")} hitSlop={10} onPress={onBack} style={styles.back}>
      <MusicIcon name="back" color={phoneColors.text} size={26} />
    </Pressable>
  </View>;
}

function AlbumTrack({ track, number, albumArtist, active, onPress, onLongPress }: {
  track: MusicTrack; number: number; albumArtist: string; active: boolean; onPress: () => void; onLongPress: () => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${number}. ${track.title}`} onPress={onPress} onLongPress={onLongPress}
    style={({ pressed }) => [styles.track, pressed && styles.pressed]}>
    <Text style={[styles.number, active && styles.active]}>{number}</Text>
    <View style={styles.trackCopy}>
      <Text numberOfLines={1} style={[styles.trackTitle, active && styles.active]}>{track.title}</Text>
      {track.artist && track.artist !== albumArtist ? <Text numberOfLines={1} style={styles.caption}>{track.artist}</Text> : null}
    </View>
    {track.rating === 1 ? <MusicIcon name="liked" color={phoneColors.textMuted} size={16} /> : null}
    <Text style={styles.caption}>{durationLabel(track.duration)}</Text>
  </Pressable>;
}

/** An album: play it in order, shuffled or from a track; save it to the library. */
export function MusicAlbumScreen({ api, session, t, playingId, id, onOpen, onBack }: PageProps) {
  const load = useCallback(() => api.album(id), [api, id]);
  const { data: album, setData, failed, retry } = usePageData<MusicAlbumPage>(load);
  const [saving, setSaving] = useState(false);
  // Fetch the album's station while the page is read, so Play starts at once.
  const warmId = album?.tracks.length ? album.browseId : null;
  useEffect(() => { if (warmId) session.warm({ kind: "album", browseId: warmId }); }, [session, warmId]);
  const play = (options: { startAt?: string; shuffle?: boolean } = {}) => {
    if (!album) return;
    void session.start({ kind: "album", browseId: album.browseId, ...(options.startAt ? { startAt: options.startAt } : {}) },
      { shuffle: options.shuffle, from: album.title });
  };
  const toggleSaved = async () => {
    if (!album || saving) return;
    const saved = !album.saved;
    setSaving(true);
    setData({ ...album, saved });
    try { await api.setAlbumSaved(album.browseId, saved); }
    catch { setData((latest) => latest && { ...latest, saved: !saved }); }
    finally { setSaving(false); }
  };
  const header = album ? <View style={styles.header}>
    <MusicArtwork api={api} url={album.thumbnail} size={200} radius={10} />
    <Text style={styles.heading}>{album.title}</Text>
    <Pressable disabled={!album.artistId} accessibilityRole={album.artistId ? "link" : undefined}
      onPress={() => album.artistId && onOpen({ kind: "artist", id: album.artistId })}>
      <Text style={[styles.subheading, album.artistId && styles.link]}>{album.artist}</Text>
    </Pressable>
    <Text style={styles.caption}>{albumDetail(album, t, false)}</Text>
    <View style={styles.actions}>
      <PhoneChip primary label={t("musicPlay")} disabled={!album.tracks.length} onPress={() => play()} />
      <PhoneChip label={t("musicShuffle")} disabled={album.tracks.length < 2} onPress={() => play({ shuffle: true })} />
      <PhoneChip label={album.saved ? t("musicSaved") : t("musicSave")} disabled={saving} onPress={() => void toggleSaved()} />
    </View>
  </View> : null;
  return <PageFrame t={t} onBack={onBack} failed={failed} failedText={t("musicAlbumFailed")} loading={!album} onRetry={retry}>
    {album ? <FlatList data={album.tracks} keyExtractor={(track) => track.videoId} ListHeaderComponent={header}
      renderItem={({ item, index }) => <AlbumTrack track={item} number={index + 1} albumArtist={album.artist} active={item.videoId === playingId}
        onPress={() => play({ startAt: item.videoId })} onLongPress={() => void session.dislike(item)} />} /> : null}
  </PageFrame>;
}

/** An artist: their station, top songs, albums and singles. */
export function MusicArtistScreen({ api, session, t, playingId, id, onOpen, onBack }: PageProps) {
  const load = useCallback(() => api.artist(id), [api, id]);
  const { data: artist, failed, retry } = usePageData<MusicArtistPage>(load);
  const openAlbum = useCallback((album: MusicAlbum) => onOpen({ kind: "album", id: album.browseId }), [onOpen]);
  const startSong = useCallback((track: MusicTrack) => void session.start({ kind: "track", videoId: track.videoId }), [session]);
  const header = artist ? <View>
    <View style={styles.header}>
      <MusicArtwork api={api} url={artist.thumbnail} size={160} radius={80} />
      <Text style={styles.heading}>{artist.name}</Text>
      <View style={styles.actions}>
        <PhoneChip primary label={t("musicPlayStation")} disabled={!artist.topSongs.length}
          onPress={() => void session.start({ kind: "artist", artistId: artist.channelId })} />
      </View>
    </View>
    {artist.topSongs.length ? <PhoneSectionTitle title={t("musicTopSongs")} /> : null}
  </View> : null;
  const footer = artist ? <View style={styles.footer}>
    <MusicShelf title={t("musicAlbums")} count={artist.albums.length}>
      {artist.albums.map((album) => <MusicAlbumCard key={album.browseId} api={api} album={album} detail={albumDetail(album, t, false)} onPress={openAlbum} />)}
    </MusicShelf>
    <MusicShelf title={t("musicSingles")} count={artist.singles.length}>
      {artist.singles.map((album) => <MusicAlbumCard key={album.browseId} api={api} album={album} detail={albumDetail(album, t, false)} onPress={openAlbum} />)}
    </MusicShelf>
  </View> : null;
  return <PageFrame t={t} onBack={onBack} failed={failed} failedText={t("musicArtistFailed")} loading={!artist} onRetry={retry}>
    {artist ? <FlatList data={artist.topSongs} keyExtractor={(track) => track.videoId} ListHeaderComponent={header} ListFooterComponent={footer}
      renderItem={({ item }) => <MusicTrackRow api={api} track={item} active={item.videoId === playingId} onPress={startSong} />} /> : null}
  </PageFrame>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: phoneColors.background },
  back: { position: "absolute", top: 4, left: 8, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" },
  loading: { padding: 48 },
  note: { alignItems: "center", gap: 12, padding: 48 },
  noteText: { ...phoneType.body, color: phoneColors.textMuted, textAlign: "center" },
  header: { alignItems: "center", gap: 6, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 },
  heading: { ...phoneType.heading, color: phoneColors.text, textAlign: "center", marginTop: 8 },
  subheading: { ...phoneType.title, color: phoneColors.text, textAlign: "center" },
  link: { textDecorationLine: "underline" },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 10 },
  track: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  pressed: { backgroundColor: "rgba(255,255,255,0.08)" },
  number: { ...phoneType.caption, color: phoneColors.textMuted, width: 22, textAlign: "right" },
  trackCopy: { flex: 1, gap: 2 },
  trackTitle: { ...phoneType.title, color: phoneColors.text },
  active: { color: phoneColors.accent },
  caption: { ...phoneType.caption, color: phoneColors.textMuted },
  footer: { paddingBottom: 16 },
});
