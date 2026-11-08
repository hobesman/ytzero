import { TvPageBackButton } from "./TvPageBackButton";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, TVFocusGuideView, useWindowDimensions, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { Translate } from "../i18n";
import { colors, screenPadding } from "../theme";
import { useCompactLayout } from "../useCompactLayout";
import { Logo } from "./Logo";
import { TvSurface } from "./TvSurface";

type Props = { title: string; description: string; t: Translate; onBack?: () => void; children: ReactNode; copyFooter?: ReactNode; copyHeader?: ReactNode };

export function TvSetupLayout(props: Props) {
  const { width, height } = useWindowDimensions();
  const compact = useCompactLayout();
  const background = <Svg pointerEvents="none" width={width} height={height} style={StyleSheet.absoluteFill}><Defs><LinearGradient id="setup-background" x1="1" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#172134" /><Stop offset="0.5" stopColor="#0b101a" /><Stop offset="1" stopColor={colors.background} /></LinearGradient></Defs><Rect width="100%" height="100%" fill="url(#setup-background)" /></Svg>;
  if (compact) return <View style={compactStyles.screen}>{background}<CompactSetup {...props} landscape={width > height} /></View>;
  const { title, description, t, onBack, children, copyFooter, copyHeader } = props;
  return <TVFocusGuideView autoFocus style={styles.screen}>
    {background}
    {onBack ? <TvPageBackButton t={t} onPress={onBack} /> : null}
    <View style={[styles.header, onBack && styles.headerWithBack]}><Logo compact /></View>
    <View style={styles.body}>
      <View style={styles.copy}>{copyHeader}<Text accessibilityRole="header" style={styles.title}>{title}</Text><Text style={styles.description}>{description}</Text>{copyFooter}</View>
      <View style={styles.card}><TvSurface material="content" radius={38}>{children}</TvSurface></View>
    </View>
  </TVFocusGuideView>;
}

/** Phone layout: everything scrolls, side by side in landscape and stacked in portrait. The decorative header is left out. */
function CompactSetup({ title, description, t, onBack, children, copyFooter, landscape }: Props & { landscape: boolean }) {
  return <ScrollView style={compactStyles.scroll} contentContainerStyle={compactStyles.content} keyboardShouldPersistTaps="handled">
    <View style={compactStyles.header}>{onBack ? <TvPageBackButton t={t} onPress={onBack} style={compactStyles.back} /> : null}<Logo compact /></View>
    <View style={[compactStyles.body, landscape && compactStyles.bodyLandscape]}>
      <View style={landscape && compactStyles.column}><Text accessibilityRole="header" style={compactStyles.title}>{title}</Text><Text style={compactStyles.description}>{description}</Text>{copyFooter}</View>
      <View style={landscape && compactStyles.column}><TvSurface material="content" radius={24}>{children}</TvSurface></View>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: screenPadding + 20, paddingVertical: 48 },
  header: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 28 },
  headerWithBack: { paddingLeft: 96 },
  body: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 100, paddingBottom: 35 },
  copy: { flex: 1, maxWidth: 650 }, title: { color: colors.text, fontSize: 58, lineHeight: 66, letterSpacing: -1.5, fontWeight: "700" },
  description: { color: colors.textMuted, fontSize: 23, lineHeight: 34, marginTop: 22, maxWidth: 570 },
  card: { flex: 1.15, maxWidth: 820, borderRadius: 38, padding: 36 },
});

const compactStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingVertical: 16 },
  header: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 },
  back: { position: "relative", top: 0, left: 0 },
  body: { flexGrow: 1, gap: 20, paddingTop: 12 },
  bodyLandscape: { flexDirection: "row", alignItems: "flex-start" },
  column: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 26, lineHeight: 32, letterSpacing: -.5, fontWeight: "700" },
  description: { color: colors.textMuted, fontSize: 15, lineHeight: 21, marginTop: 8 },
});
