import { useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Translate } from "../i18n";
import { PhoneChip } from "./PhoneChip";
import { phoneColors, phoneType } from "./phoneTheme";

/**
 * A bottom sheet asking for one whole number, e.g. a custom setting value.
 * Saves only a number within `min`..`max`; the caller words the range in `hint`.
 */
export function PhoneNumberSheet({ title, hint, unit, value, min, max, t, onSave, onClose }: {
  title: string; hint: string; unit?: string; value: number; min: number; max: number; t: Translate;
  onSave: (value: number) => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(String(value));
  const number = Number(text);
  const valid = text !== "" && Number.isInteger(number) && number >= min && number <= max;
  const save = () => { if (valid) onSave(number); };
  return <Modal transparent visible animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <KeyboardAvoidingView behavior="padding" style={styles.flex}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("close")} style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>{title}</Text>
        <View style={styles.field}>
          <TextInput value={text} onChangeText={(next) => setText(next.replace(/\D/g, "").slice(0, String(max).length))}
            autoFocus keyboardType="number-pad" returnKeyType="done" onSubmitEditing={save} accessibilityLabel={title}
            style={styles.input} selectionColor={phoneColors.accent} />
          {unit ? <Text style={styles.unit}>{unit}</Text> : null}
        </View>
        <Text style={[styles.hint, text !== "" && !valid && styles.invalid]}>{hint}</Text>
        <View style={styles.actions}>
          <PhoneChip label={t("cancel")} onPress={onClose} />
          <PhoneChip primary label={t("save")} disabled={!valid} onPress={save} />
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: phoneColors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8 },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: phoneColors.surfaceRaised, marginBottom: 8 },
  title: { ...phoneType.title, fontSize: 17, color: phoneColors.text, paddingHorizontal: 16, paddingVertical: 8 },
  field: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 4 },
  input: { flex: 1, height: 48, borderRadius: 12, paddingHorizontal: 16, backgroundColor: phoneColors.surfaceRaised, color: phoneColors.text, fontSize: 20 },
  unit: { ...phoneType.body, color: phoneColors.textMuted },
  hint: { ...phoneType.caption, color: phoneColors.textMuted, paddingHorizontal: 16, paddingTop: 8 },
  invalid: { color: phoneColors.danger },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, padding: 16 },
});
