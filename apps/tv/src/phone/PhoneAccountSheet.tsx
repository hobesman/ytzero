import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SidebarIcon } from "../components/SidebarIcon";
import type { Translate } from "../i18n";
import { PhoneListRow } from "./PhoneList";
import { phoneColors, phoneType } from "./phoneTheme";

/** The avatar menu: the current profile, History and Settings. */
export function PhoneAccountSheet({ name, color, t, onHistory, onSettings, onClose }: {
  name: string; color: string; t: Translate; onHistory: () => void; onSettings: () => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return <Modal transparent visible animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <Pressable accessibilityRole="button" accessibilityLabel={t("close")} style={styles.scrim} onPress={onClose} />
    <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.handle} />
      <View style={styles.profile}>
        <View style={[styles.avatar, { backgroundColor: color }]}><Text style={styles.initial}>{name.slice(0, 1).toUpperCase()}</Text></View>
        <View><Text style={styles.name}>{name}</Text><Text style={styles.caption}>{t("account")}</Text></View>
      </View>
      <PhoneListRow icon={<SidebarIcon name="history" color={phoneColors.text} size={22} />} title={t("navHistory")} onPress={onHistory} />
      <PhoneListRow icon={<SidebarIcon name="settings" color={phoneColors.text} size={22} />} title={t("navSettings")} onPress={onSettings} />
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: phoneColors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8 },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: phoneColors.surfaceRaised, marginBottom: 8 },
  profile: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: phoneColors.divider, marginBottom: 6 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  initial: { color: "#fff", fontSize: 18, fontWeight: "700" },
  name: { ...phoneType.title, fontSize: 17, color: phoneColors.text },
  caption: { ...phoneType.caption, color: phoneColors.textMuted },
});
