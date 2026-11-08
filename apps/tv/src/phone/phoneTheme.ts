import { colors } from "../theme";

/** Phone layout tokens: the TV palette at phone reading sizes. */
export const phoneColors = {
  background: colors.background,
  surface: colors.surface,
  surfaceRaised: colors.surfaceRaised,
  divider: "rgba(255,255,255,0.1)",
  text: colors.text,
  textMuted: colors.textMuted,
  accent: colors.accentStrong,
  danger: colors.danger,
};

export const phoneType = {
  heading: { fontSize: 22, lineHeight: 28, fontWeight: "700" as const },
  section: { fontSize: 18, lineHeight: 24, fontWeight: "700" as const },
  title: { fontSize: 15, lineHeight: 20, fontWeight: "600" as const },
  body: { fontSize: 14, lineHeight: 19 },
  caption: { fontSize: 12.5, lineHeight: 17 },
};

export const phoneMetrics = { topBar: 56, tabBar: 58, gutter: 16 };
