import { memo, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Translate } from "../i18n";
import { PhoneSectionTitle } from "../phone/PhoneList";
import { phoneColors, phoneType } from "../phone/phoneTheme";
import type { MusicAlbum, MusicApi, MusicArtist } from "./musicApi";
import { MusicArtwork } from "./MusicTrackRow";

const TILE = 140;

/** "Album · 1969", or the artist when the list mixes artists. */
export function albumDetail(album: MusicAlbum, t: Translate, withArtist: boolean): string {
  const kind = album.kind === "single" ? t("musicSingle") : t("musicAlbum");
  return [withArtist ? album.artist : kind, album.year].filter(Boolean).join(" · ");
}

/** An album's artwork tile with its title underneath. */
export const MusicAlbumCard = memo(function MusicAlbumCard({ api, album, detail, onPress }: {
  api: MusicApi; album: MusicAlbum; detail: string; onPress: (album: MusicAlbum) => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${album.title}, ${detail}`} onPress={() => onPress(album)}
    style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
    <MusicArtwork api={api} url={album.thumbnail} size={TILE} radius={8} />
    <Text numberOfLines={2} style={styles.title}>{album.title}</Text>
    <Text numberOfLines={1} style={styles.detail}>{detail}</Text>
  </Pressable>;
});

/** An artist's round picture with their name underneath. */
export const MusicArtistCard = memo(function MusicArtistCard({ api, artist, onPress }: {
  api: MusicApi; artist: MusicArtist; onPress: (artist: MusicArtist) => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={artist.name} onPress={() => onPress(artist)}
    style={({ pressed }) => [styles.artist, pressed && styles.pressed]}>
    <MusicArtwork api={api} url={artist.thumbnail} size={96} radius={48} />
    <Text numberOfLines={2} style={[styles.title, styles.center]}>{artist.name}</Text>
  </Pressable>;
});

/** A titled row that scrolls sideways; left out when it has nothing to show. */
export function MusicShelf({ title, children, count }: { title: string; children: ReactNode; count: number }) {
  if (!count) return null;
  return <View>
    <PhoneSectionTitle title={title} />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  shelf: { gap: 12, paddingHorizontal: 16, paddingBottom: 4 },
  tile: { width: TILE, gap: 4, borderRadius: 8 },
  artist: { width: 104, alignItems: "center", gap: 6, borderRadius: 8, paddingVertical: 2 },
  pressed: { opacity: 0.7 },
  title: { ...phoneType.title, fontSize: 14, color: phoneColors.text },
  center: { textAlign: "center" },
  detail: { ...phoneType.caption, color: phoneColors.textMuted },
});
