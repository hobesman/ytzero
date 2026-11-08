import { Pressable, StyleSheet, Text } from "react-native";
import { phoneColors, phoneType } from "./phoneTheme";

/** A pill-shaped phone action; `primary` is the filled, emphasized one. */
export function PhoneChip({ label, primary, disabled, onPress }: { label: string; primary?: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.chip, primary && styles.primary, (pressed || disabled) && styles.dimmed]}>
    <Text style={[styles.text, primary && styles.primaryText]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 18, backgroundColor: phoneColors.surfaceRaised },
  primary: { backgroundColor: phoneColors.text },
  dimmed: { opacity: 0.6 },
  text: { ...phoneType.body, fontWeight: "600", color: phoneColors.text },
  primaryText: { color: "#000" },
});
