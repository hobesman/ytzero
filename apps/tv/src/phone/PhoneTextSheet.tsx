import { useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Translate } from "../i18n";
import { PhoneChip } from "./PhoneChip";
import { phoneColors, phoneType } from "./phoneTheme";

/**
 * A bottom sheet asking for one line of text, such as a name. `onSave` gets the
 * trimmed text and may be async; the sheet stays open, showing `error`, if it fails.
 */
export function PhoneTextSheet({ title, label, value = "", saveLabel, error, maxLength = 150, t, onSave, onClose }: {
  title: string; label: string; value?: string; saveLabel: string; error: string; maxLength?: number; t: Translate;
  onSave: (text: string) => Promise<void> | void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const valid = text.trim().length > 0;
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true); setFailed(false);
    try { await onSave(text.trim()); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  };
  return <Modal transparent visible animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <KeyboardAvoidingView behavior="padding" style={styles.flex}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("close")} style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>{title}</Text>
        <TextInput value={text} onChangeText={setText} maxLength={maxLength} autoFocus returnKeyType="done" onSubmitEditing={() => void save()}
          accessibilityLabel={label} placeholder={label} placeholderTextColor={phoneColors.textMuted}
          style={styles.input} selectionColor={phoneColors.accent} />
        {failed ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          <PhoneChip label={t("cancel")} onPress={onClose} />
          <PhoneChip primary label={saveLabel} disabled={!valid || busy} onPress={() => void save()} />
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
  input: { height: 48, marginHorizontal: 16, marginTop: 4, borderRadius: 12, paddingHorizontal: 16, backgroundColor: phoneColors.surfaceRaised, color: phoneColors.text, fontSize: 17 },
  error: { ...phoneType.caption, color: phoneColors.danger, paddingHorizontal: 16, paddingTop: 8 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, padding: 16 },
});
