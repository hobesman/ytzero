import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SidebarIcon } from "../components/SidebarIcon";
import type { Translate } from "../i18n";
import { PhoneChip } from "../phone/PhoneChip";
import { PhoneSectionTitle } from "../phone/PhoneList";
import { phoneColors, phoneType } from "../phone/phoneTheme";
import { albumDetail, MusicAlbumCard, MusicArtistCard, MusicShelf } from "./MusicAlbumCard";
import type { MusicAlbum, MusicApi, MusicArtist, MusicLibrary, MusicSearchResults, MusicTrack } from "./musicApi";
import type { MusicPage } from "./MusicPages";
import { MusicIcon, type MusicIconName } from "./MusicIcon";
import type { MusicSession } from "./musicSession";
import { MusicTrackRow } from "./MusicTrackRow";

type Library = MusicLibrary;

/** The profile's liked songs and recent plays, reloaded each time the screen is shown. */
function useMusicLibrary(api: MusicApi, visible: boolean) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    api.library().then(setLibrary, () => setFailed(true));
  }, [api]);
  useEffect(() => { if (visible) load(); }, [load, visible]);
  return { library, failed, load };
}

type ScreenProps = { api: MusicApi; session: MusicSession; t: Translate; visible: boolean; playingId: string | null; onOpen: (page: MusicPage) => void };

function StationCard({ icon, title, hint, onPress }: { icon: MusicIconName | "liked"; title: string; hint: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${hint}`} onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
    <View style={styles.cardIcon}>{icon === "liked" ? <SidebarIcon name="liked" color={phoneColors.text} size={26} /> : <MusicIcon name={icon} color={phoneColors.text} size={26} />}</View>
    <View style={styles.cardCopy}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardHint}>{hint}</Text>
    </View>
    <MusicIcon name="play" color={phoneColors.text} size={22} />
  </Pressable>;
}

function Note({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return <View style={styles.note}>
    <Text style={styles.noteText}>{text}</Text>
    {action && onAction ? <PhoneChip label={action} onPress={onAction} /> : null}
  </View>;
}

/** Home: start your mix or your liked songs, or pick up a recent song's station. */
export function MusicHomeScreen({ api, session, t, visible, playingId }: ScreenProps) {
  const { library, failed, load } = useMusicLibrary(api, visible);
  const start = useCallback((track: MusicTrack) => void session.start({ kind: "track", videoId: track.videoId }), [session]);
  // The mix is the likeliest first tap, so fetch it ahead while nothing plays.
  const hasMix = Boolean(library?.recent.length);
  useEffect(() => { if (visible && hasMix && !playingId) session.warm({ kind: "mix" }); }, [hasMix, playingId, session, visible]);
  const header = <View>
    <View style={styles.cards}>
      {/* The mix is built from what the profile played, so it needs some plays first. */}
      {library?.recent.length ? <StationCard icon="note" title={t("musicYourMix")} hint={t("musicYourMixHint")} onPress={() => void session.start({ kind: "mix" })} /> : null}
      {library?.liked.length ? <StationCard icon="liked" title={t("musicLikedSongs")} hint={t("musicLikedSongsHint")} onPress={() => void session.start({ kind: "liked" })} /> : null}
    </View>
    <PhoneSectionTitle title={t("musicRecent")} />
    {failed ? <Note text={t("musicLoadFailed")} action={t("musicRetry")} onAction={load} />
      : !library ? <ActivityIndicator style={styles.loading} color={phoneColors.textMuted} />
      : library.recent.length === 0 ? <Note text={t("musicRecentEmpty")} /> : null}
  </View>;
  return <FlatList data={library?.recent ?? []} keyExtractor={(track) => track.videoId} ListHeaderComponent={header}
    renderItem={({ item }) => <MusicTrackRow api={api} track={item} active={item.videoId === playingId} onPress={start} />} />;
}

/** Library: the albums this profile saved and the songs it liked in music mode. */
export function MusicLibraryScreen({ api, session, t, visible, playingId, onOpen }: ScreenProps) {
  const { library, failed, load } = useMusicLibrary(api, visible);
  const start = useCallback((track: MusicTrack) => void session.start({ kind: "track", videoId: track.videoId }), [session]);
  const openAlbum = useCallback((album: MusicAlbum) => onOpen({ kind: "album", id: album.browseId }), [onOpen]);
  const header = <View>
    <MusicShelf title={t("musicSavedAlbums")} count={library?.albums.length ?? 0}>
      {library?.albums.map((album) => <MusicAlbumCard key={album.browseId} api={api} album={album} detail={albumDetail(album, t, true)} onPress={openAlbum} />)}
    </MusicShelf>
    {library?.liked.length ? <View style={styles.cards}>
      <StationCard icon="liked" title={t("musicLikedSongs")} hint={t("musicLikedSongsHint")} onPress={() => void session.start({ kind: "liked" })} />
    </View> : null}
    {failed ? <Note text={t("musicLoadFailed")} action={t("musicRetry")} onAction={load} />
      : !library ? <ActivityIndicator style={styles.loading} color={phoneColors.textMuted} />
      : library.liked.length === 0 && library.albums.length === 0 ? <Note text={t("musicLibraryEmpty")} /> : null}
  </View>;
  return <FlatList data={library?.liked ?? []} keyExtractor={(track) => track.videoId} ListHeaderComponent={header}
    renderItem={({ item }) => <MusicTrackRow api={api} track={item} active={item.videoId === playingId} onPress={start} />} />;
}

/** Search: artists, albums and songs from YouTube Music; a song starts a station from it. */
export function MusicSearchScreen({ api, session, t, playingId, onOpen }: ScreenProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MusicSearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const search = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    const id = ++request.current;
    setSearching(true); setFailed(false); setResults(null);
    try {
      const found = await api.search(q);
      if (id === request.current) setResults(found);
    } catch {
      if (id === request.current) setFailed(true);
    } finally { if (id === request.current) setSearching(false); }
  }, [api, query]);
  const clear = () => { request.current++; setQuery(""); setResults(null); setSearching(false); setFailed(false); };
  const start = useCallback((track: MusicTrack) => void session.start({ kind: "track", videoId: track.videoId }), [session]);
  const openAlbum = useCallback((album: MusicAlbum) => onOpen({ kind: "album", id: album.browseId }), [onOpen]);
  const openArtist = useCallback((artist: MusicArtist) => onOpen({ kind: "artist", id: artist.channelId }), [onOpen]);
  const empty = results && !results.tracks.length && !results.albums.length && !results.artists.length;
  // The top song is the likeliest tap; albums and artists warm their own Play on their pages.
  const topSong = results?.tracks[0]?.videoId ?? null;
  useEffect(() => { if (topSong && !playingId) session.warm({ kind: "track", videoId: topSong }); }, [playingId, session, topSong]);
  const header = results ? <View>
    <MusicShelf title={t("musicArtists")} count={results.artists.length}>
      {results.artists.map((artist) => <MusicArtistCard key={artist.channelId} api={api} artist={artist} onPress={openArtist} />)}
    </MusicShelf>
    <MusicShelf title={t("musicAlbums")} count={results.albums.length}>
      {results.albums.map((album) => <MusicAlbumCard key={album.browseId} api={api} album={album} detail={albumDetail(album, t, true)} onPress={openAlbum} />)}
    </MusicShelf>
    {results.tracks.length ? <PhoneSectionTitle title={t("musicSongs")} /> : null}
  </View> : null;
  return <View style={styles.flex}>
    <View style={styles.field}>
      <SidebarIcon name="search" color={phoneColors.textMuted} size={20} />
      <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} returnKeyType="search"
        placeholder={t("musicSearchHint")} placeholderTextColor={phoneColors.textMuted} style={styles.input} autoCorrect={false} />
      {query ? <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel={t("searchClear")} onPress={clear}>
        <Text style={styles.clear}>×</Text>
      </Pressable> : null}
    </View>
    {searching ? <ActivityIndicator style={styles.loading} color={phoneColors.text} accessibilityLabel={t("searchLoading")} /> : null}
    {failed ? <Note text={t("musicSearchFailed")} action={t("musicRetry")} onAction={() => void search()} /> : null}
    {empty ? <Note text={t("musicNoResults")} /> : null}
    <FlatList data={results?.tracks ?? []} keyExtractor={(track) => track.videoId} keyboardShouldPersistTaps="handled" ListHeaderComponent={header}
      renderItem={({ item }) => <MusicTrackRow api={api} track={item} active={item.videoId === playingId} onPress={start} />} />
  </View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  cards: { gap: 10, paddingHorizontal: 16, paddingTop: 8 },
  card: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 14, backgroundColor: phoneColors.surface },
  pressed: { backgroundColor: phoneColors.surfaceRaised },
  cardIcon: { width: 48, height: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: phoneColors.surfaceRaised },
  cardCopy: { flex: 1, gap: 2 },
  cardTitle: { ...phoneType.title, fontSize: 16, color: phoneColors.text },
  cardHint: { ...phoneType.caption, color: phoneColors.textMuted },
  loading: { padding: 24 },
  note: { alignItems: "center", gap: 12, padding: 24 },
  noteText: { ...phoneType.body, color: phoneColors.textMuted, textAlign: "center" },
  field: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginVertical: 8, paddingHorizontal: 14, height: 44, borderRadius: 22, backgroundColor: phoneColors.surface },
  input: { flex: 1, color: phoneColors.text, fontSize: 15, paddingVertical: 0 },
  clear: { color: phoneColors.textMuted, fontSize: 24, lineHeight: 26 },
});
