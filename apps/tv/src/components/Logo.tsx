import { StyleSheet, Text, View } from "react-native";
import Svg, { G, Path, Rect } from "react-native-svg";
import { buildBranding } from "../branding";
import { colors } from "../theme";

export function LogoMark({ size, accessibilityLabel, color = buildBranding.color, layer = "all" }: { size: number; accessibilityLabel?: string; color?: string; layer?: "all" | "tile" | "play" }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={accessibilityLabel}>
      {layer !== "play" ? <Rect width="24" height="24" rx="5.25" fill={color} /> : null}
      {layer !== "tile" ? <G transform="translate(5.25 5.25) scale(0.5625)">
        <Path
          d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"
          fill={colors.white}
          stroke={colors.white}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G> : null}
    </Svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  const size = compact ? 38 : 54;
  return (
    <View style={styles.row}>
      <LogoMark size={size} accessibilityLabel={buildBranding.name} />
      <Text style={[styles.name, compact && styles.nameCompact]}>{buildBranding.name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 15 },
  name: { color: colors.text, fontWeight: "700", fontSize: 34, letterSpacing: -1.1 },
  nameCompact: { fontSize: 26, letterSpacing: -0.8 },
});
