import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import type { Translate } from "../i18n";
import { subtitleAppearance } from "../subtitles";
import type { TvProfileSettings } from "../types";
import type { SubtitleState } from "../useSubtitles";
import { TvChoiceSheet } from "./TvChoiceSheet";

const OFF = "__off__";

/**
 * The line showing now, over the bottom of the video. `raised` lifts it above
 * the player's own controls while they show; `compact` is the phone's small
 * player in the details page.
 */
export function SubtitleOverlay({ lines, settings, raised, compact }: {
  lines: string[]; settings: TvProfileSettings | null | undefined; raised: boolean; compact: boolean;
}) {
  if (!lines.length) return null;
  const look = subtitleAppearance(settings);
  const base = Platform.isTV ? 30 : compact ? 13 : 17;
  const fontSize = Math.round(base * look.scale);
  const offset = Platform.isTV ? raised ? 190 : 56 : compact ? raised ? 44 : 8 : raised ? 96 : 28;
  return <View pointerEvents="none" style={[styles.overlay, { bottom: offset }]}>
    <Text style={[styles.text, { fontSize, lineHeight: Math.round(fontSize * 1.3), color: look.color, backgroundColor: look.background }]}>
      {lines.join("\n")}
    </Text>
  </View>;
}

/** The CC button beside the quality and speed buttons, shown when the video has subtitles. */
export function SubtitleButton({ state, t, style, pressedStyle, textStyle, onPress }: {
  state: SubtitleState; t: Translate;
  style: StyleProp<ViewStyle>; pressedStyle: StyleProp<ViewStyle>; textStyle: StyleProp<TextStyle>; onPress: () => void;
}) {
  if (!state.tracks.length) return null;
  const on = state.selected !== null;
  const label = state.tracks.find((track) => track.lang === state.selected)?.label ?? t("subtitlesOff");
  return <Pressable accessibilityRole="button" accessibilityLabel={`${t("subtitles")}: ${label}`} accessibilityState={{ selected: on }} hitSlop={12}
    style={({ pressed }) => [style, on && styles.buttonOn, pressed && pressedStyle]} onPress={onPress}>
    <Text style={[textStyle, on && styles.buttonOnText]}>CC</Text>
  </Pressable>;
}

/** Off, then each track: the profile's languages first. */
export function SubtitleSheet({ state, t, onClose }: { state: SubtitleState; t: Translate; onClose: () => void }) {
  return <TvChoiceSheet title={t("subtitles")} t={t} value={state.selected ?? OFF}
    error={state.failed ? t("subtitlesFailed") : undefined}
    options={[{ value: OFF, label: t("subtitlesOff") }, ...state.tracks.map((track) => ({ value: track.lang, label: track.label }))]}
    onSelect={(value) => { state.select(value === OFF ? null : value); onClose(); }}
    onClose={onClose} />;
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  text: { textAlign: "center", fontWeight: "600", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, overflow: "hidden" },
  buttonOn: { backgroundColor: "rgba(255, 255, 255, 0.9)" },
  buttonOnText: { color: "#000000" },
});
