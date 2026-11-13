import { memo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { phoneColors, phoneType } from "../phone/phoneTheme";
import type { MusicApi, MusicTrack } from "./musicApi";
import { MusicIcon } from "./MusicIcon";

export function durationLabel(seconds: number | null | undefined) {
  if (!seconds || seconds < 0) return "";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Square artwork, or a note on a plain tile when the song has none. */
export function MusicArtwork({ api, url, size, radius = 6 }: { api: MusicApi; url: string | null | undefined; size: number; radius?: number }) {
  const source = api.artworkSource(url);
  const box = { width: size, height: size, borderRadius: radius };
  if (!source) return <View style={[box, styles.placeholder]}><MusicIcon name="note" color={phoneColors.textMuted} size={size * 0.45} /></View>;
  return <Image source={source} style={[box, styles.art]} resizeMode="cover" />;
}

/** One song in a list: artwork, title, artist and length. */
export const MusicTrackRow = memo(function MusicTrackRow({ api, track, active, onPress, onLongPress }: {
  api: MusicApi; track: MusicTrack; active?: boolean; onPress: (track: MusicTrack) => void; onLongPress?: (track: MusicTrack) => void;
}) {
  const detail = [track.artist, track.album].filter(Boolean).join(" · ");
  return <Pressable accessibilityRole="button" accessibilityLabel={`${track.title}, ${track.artist}`}
    onPress={() => onPress(track)} onLongPress={onLongPress ? () => onLongPress(track) : undefined}
    style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
    <MusicArtwork api={api} url={track.thumbnail} size={48} />
    <View style={styles.copy}>
      <Text numberOfLines={1} style={[styles.title, active && styles.active]}>{track.title}</Text>
      <Text numberOfLines={1} style={styles.detail}>{detail}</Text>
    </View>
    {track.rating === 1 ? <MusicIcon name="liked" color={phoneColors.textMuted} size={16} /> : null}
    <Text style={styles.duration}>{durationLabel(track.duration)}</Text>
  </Pressable>;
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 8 },
  pressed: { backgroundColor: "rgba(255,255,255,0.08)" },
  art: { backgroundColor: phoneColors.surfaceRaised },
  placeholder: { backgroundColor: phoneColors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, gap: 2 },
  title: { ...phoneType.title, color: phoneColors.text },
  active: { color: phoneColors.accent },
  detail: { ...phoneType.caption, color: phoneColors.textMuted },
  duration: { ...phoneType.caption, color: phoneColors.textMuted, minWidth: 34, textAlign: "right" },
});
