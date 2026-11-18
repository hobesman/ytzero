import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { phoneColors, phoneType } from "./phoneTheme";

/** A tappable phone list row: icon, title, optional detail and trailing control. */
export function PhoneListRow({ icon, title, detail, trailing, danger, onPress }: {
  icon?: ReactNode; title: string; detail?: string; trailing?: ReactNode; danger?: boolean; onPress?: () => void;
}) {
  const content = <>
    {icon ? <View style={styles.icon}>{icon}</View> : null}
    <View style={styles.copy}>
      <Text style={[styles.title, danger && styles.danger]}>{title}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
    {trailing}
  </>;
  if (!onPress) return <View style={styles.row}>{content}</View>;
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>{content}</Pressable>;
}

export function PhoneSectionTitle({ title }: { title: string }) {
  return <Text style={styles.section}>{title}</Text>;
}

/** A heading over several sections, such as a group of settings. */
export function PhoneGroupTitle({ title }: { title: string }) {
  return <Text accessibilityRole="header" style={styles.group}>{title}</Text>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 56, paddingHorizontal: 16, paddingVertical: 10 },
  pressed: { backgroundColor: "rgba(255,255,255,0.08)" },
  icon: { minWidth: 26, alignItems: "center" },
  copy: { flex: 1, gap: 2 },
  title: { ...phoneType.body, fontSize: 15, color: phoneColors.text },
  danger: { color: phoneColors.danger },
  detail: { ...phoneType.caption, color: phoneColors.textMuted },
  group: { ...phoneType.section, color: phoneColors.text, paddingHorizontal: 16, paddingTop: 30, paddingBottom: 2 },
  section: { ...phoneType.caption, fontWeight: "700", color: phoneColors.textMuted, textTransform: "uppercase", letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 22, paddingBottom: 6 },
});
