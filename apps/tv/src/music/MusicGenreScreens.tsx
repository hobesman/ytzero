import { memo, useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { Translate } from "../i18n";
import { PhoneChip } from "../phone/PhoneChip";
import { PhoneSectionTitle } from "../phone/PhoneList";
import { phoneColors, phoneType } from "../phone/phoneTheme";
import { MusicListShelf, MusicShelf } from "./MusicAlbumCard";
import type { MusicApi, MusicGenre, MusicGenrePage, MusicPlaylist, MusicPlaylistPage, MusicTrack } from "./musicApi";
import { PageFrame, usePageData, type MusicPage, type PageProps } from "./MusicPages";
import { MusicArtwork, MusicTrackRow } from "./MusicTrackRow";

const TILE = 140;
const playlistKey = (playlist: MusicPlaylist) => playlist.playlistId;

/** Genre tiles two to a column, so a shelf scrolls sideways through all of them. */
function columns<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += 2) out.push(items.slice(index, index + 2));
  return out;
}

const GenreTile = memo(function GenreTile({ genre, onPress }: { genre: MusicGenre; onPress: (genre: MusicGenre) => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={genre.title} onPress={() => onPress(genre)}
    style={({ pressed }) => [styles.genre, { borderLeftColor: genre.color ?? phoneColors.textMuted }, pressed && styles.pressed]}>
    <Text numberOfLines={2} style={styles.genreTitle}>{genre.title}</Text>
  </Pressable>;
});

/**
 * Home's Moods & moments and Genres, from YouTube Music. The list is loaded
 * once; a failure leaves the shelves out rather than covering Home with an error.
 */
export function MusicGenreShelves({ api, t, visible, onOpen }: { api: MusicApi; t: Translate; visible: boolean; onOpen: (page: MusicPage) => void }) {
  const [genres, setGenres] = useState<MusicGenre[] | null>(null);
  useEffect(() => {
    if (!visible || genres) return;
    let live = true;
    api.genres().then((list) => { if (live) setGenres(list); }, () => {});
    return () => { live = false; };
  }, [api, genres, visible]);
  const open = useCallback((genre: MusicGenre) => onOpen({ kind: "genre", id: genre.id, title: genre.title }), [onOpen]);
  if (!genres?.length) return null;
  const shelf = (title: string, list: MusicGenre[]) => <MusicShelf title={title} count={list.length}>
    {columns(list).map((pair) => <View key={pair.map((genre) => genre.id).join(":")} style={styles.column}>
      {pair.map((genre) => <GenreTile key={genre.id} genre={genre} onPress={open} />)}
    </View>)}
  </MusicShelf>;
  return <View>
    {shelf(t("musicMoods"), genres.filter((genre) => genre.group === "mood"))}
    {shelf(t("musicGenres"), genres.filter((genre) => genre.group === "genre"))}
  </View>;
}

export const MusicPlaylistCard = memo(function MusicPlaylistCard({ api, playlist, onPress }: {
  api: MusicApi; playlist: MusicPlaylist; onPress: (playlist: MusicPlaylist) => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={playlist.title} onPress={() => onPress(playlist)}
    style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
    <MusicArtwork api={api} url={playlist.thumbnail} size={TILE} radius={8} />
    <Text numberOfLines={2} style={styles.title}>{playlist.title}</Text>
    {playlist.subtitle ? <Text numberOfLines={1} style={styles.cardDetail}>{playlist.subtitle}</Text> : null}
  </Pressable>;
});

/** A category: YouTube Music's playlist shelves for it. */
export function MusicGenreScreen({ api, t, id, title, onOpen, onBack }: PageProps & { title: string }) {
  const load = useCallback(() => api.genre(id), [api, id]);
  const { data: page, failed, retry } = usePageData<MusicGenrePage>(load);
  const open = useCallback((playlist: MusicPlaylist) => onOpen({ kind: "playlist", id: playlist.playlistId }), [onOpen]);
  const card = useCallback((playlist: MusicPlaylist) => <MusicPlaylistCard api={api} playlist={playlist} onPress={open} />, [api, open]);
  // Shelves and the cards in them are both virtualized: only those near the screen are built.
  return <PageFrame t={t} onBack={onBack} failed={failed} failedText={t("musicGenreFailed")} loading={!page} onRetry={retry}>
    {page ? <FlatList data={page.shelves} keyExtractor={(shelf, index) => `${index}:${shelf.title}`}
      contentContainerStyle={styles.genrePage} ListHeaderComponent={<Text style={styles.heading}>{page.title || title}</Text>}
      renderItem={({ item: shelf }) => <MusicListShelf title={shelf.title} data={shelf.playlists} keyOf={playlistKey} render={card} />}
      initialNumToRender={3} maxToRenderPerBatch={2} windowSize={5} removeClippedSubviews /> : null}
  </PageFrame>;
}

/** A playlist: play it as a shuffled station, or start a station from one of its songs. */
export function MusicPlaylistScreen({ api, session, t, playingId, id, onBack }: PageProps) {
  const load = useCallback(() => api.playlist(id), [api, id]);
  const { data: playlist, setData, failed, retry } = usePageData<MusicPlaylistPage>(load);
  const [saving, setSaving] = useState(false);
  const warmId = playlist?.tracks.length ? playlist.playlistId : null;
  useEffect(() => { if (warmId) session.warm({ kind: "playlist", playlistId: warmId }); }, [session, warmId]);
  const startSong = useCallback((track: MusicTrack) => void session.start({ kind: "track", videoId: track.videoId }), [session]);
  // Saving keeps the playlist in the library, as an album is kept.
  const toggleSaved = async () => {
    if (!playlist || saving) return;
    const saved = !playlist.saved;
    setSaving(true);
    setData({ ...playlist, saved });
    try { await api.setPlaylistSaved(playlist.playlistId, saved); }
    catch { setData((latest) => latest && { ...latest, saved: !saved }); }
    finally { setSaving(false); }
  };
  const header = playlist ? <View>
    <View style={styles.header}>
      <MusicArtwork api={api} url={playlist.thumbnail} size={200} radius={10} />
      <Text style={styles.heading}>{playlist.title}</Text>
      {playlist.subtitle ? <Text style={styles.detail}>{playlist.subtitle}</Text> : null}
      <View style={styles.actions}>
        <PhoneChip primary label={t("musicShuffle")} disabled={!playlist.tracks.length}
          onPress={() => void session.start({ kind: "playlist", playlistId: playlist.playlistId }, { from: playlist.title })} />
        <PhoneChip label={playlist.saved ? t("musicSaved") : t("musicSave")} disabled={saving} onPress={() => void toggleSaved()} />
      </View>
    </View>
    {playlist.tracks.length ? <PhoneSectionTitle title={t("musicSongs")} /> : null}
  </View> : null;
  return <PageFrame t={t} onBack={onBack} failed={failed} failedText={t("musicPlaylistFailed")} loading={!playlist} onRetry={retry}>
    {playlist ? <FlatList data={playlist.tracks} keyExtractor={(track) => track.videoId} ListHeaderComponent={header}
      renderItem={({ item }) => <MusicTrackRow api={api} track={item} active={item.videoId === playingId} onPress={startSong} />} /> : null}
  </PageFrame>;
}

const styles = StyleSheet.create({
  column: { gap: 10 },
  genre: { width: 150, height: 52, justifyContent: "center", paddingHorizontal: 12, borderRadius: 8, borderLeftWidth: 6, backgroundColor: phoneColors.surface },
  genreTitle: { ...phoneType.title, fontSize: 14, color: phoneColors.text },
  tile: { width: TILE, gap: 4, borderRadius: 8 },
  pressed: { opacity: 0.7 },
  title: { ...phoneType.title, fontSize: 14, color: phoneColors.text },
  detail: { ...phoneType.caption, color: phoneColors.textMuted, textAlign: "center" },
  cardDetail: { ...phoneType.caption, color: phoneColors.textMuted },
  genrePage: { paddingTop: 52, paddingBottom: 16 },
  heading: { ...phoneType.heading, color: phoneColors.text, textAlign: "center", marginTop: 8, paddingHorizontal: 24 },
  header: { alignItems: "center", gap: 6, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 10 },
});
