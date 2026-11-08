import { useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { YtZeroApi } from "../api";
import { SidebarIcon } from "../components/SidebarIcon";
import type { Translate } from "../i18n";
import type { Profile } from "../types";
import { PhoneChip } from "./PhoneChip";
import { PhoneListRow, PhoneSectionTitle } from "./PhoneList";
import { phoneColors, phoneType } from "./phoneTheme";

export type PhoneProfiles = {
  active: Profile; profiles: Profile[]; canSwitch: boolean; childLockEnabled: boolean;
  incognito: boolean; onIncognitoChange: (value: boolean) => void;
  onSwitch: (profileId: number, pin?: string, childLockPin?: string) => Promise<void>;
};

const pinPattern = /^\d{6}$/;

/** The profile's avatar: its picture, or its initial on its color. */
export function PhoneProfileAvatar({ api, profile, size }: { api: YtZeroApi; profile: Profile; size: number }) {
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (profile.avatar) return <Image source={api.avatarSource(profile.avatar)} style={[round, styles.avatarImage]} resizeMode="cover" />;
  return <View style={[round, styles.avatarFallback, { backgroundColor: profile.avatar_color || phoneColors.accent }]}>
    <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{profile.name.slice(0, 1).toUpperCase()}</Text>
  </View>;
}

/**
 * The avatar menu: the current profile, incognito, History and Settings, and
 * the profiles this device may switch to. A profile PIN, or the child lock
 * PIN when leaving a child profile, is asked for in the sheet itself.
 */
export function PhoneAccountSheet({ api, profiles: state, t, onHistory, onSettings, onClose }: {
  api: YtZeroApi; profiles: PhoneProfiles; t: Translate; onHistory: () => void; onSettings: () => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { active, canSwitch, childLockEnabled, incognito } = state;
  const [pinFor, setPinFor] = useState<Profile | null>(null);
  const [profilePin, setProfilePin] = useState("");
  const [childLockPin, setChildLockPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const others = canSwitch ? state.profiles.filter((profile) => profile.id !== active.id && profile.can_switch) : [];
  const needsChildLock = Boolean(pinFor && active.is_child && childLockEnabled);
  const pinComplete = Boolean(pinFor && (!pinFor.has_pin || pinPattern.test(profilePin)) && (!needsChildLock || pinPattern.test(childLockPin)));

  const perform = async (profile: Profile) => {
    if (busy) return;
    setBusy(true); setError(false);
    try {
      await state.onSwitch(profile.id, profilePin || undefined, childLockPin || undefined);
      onClose();
    } catch {
      setError(true); setProfilePin(""); setChildLockPin("");
    } finally { setBusy(false); }
  };
  const choose = (profile: Profile) => {
    if (busy || profile.pin_locked) return;
    if (profile.has_pin || (active.is_child && childLockEnabled)) {
      setPinFor(profile); setProfilePin(""); setChildLockPin(""); setError(false);
      return;
    }
    void perform(profile);
  };
  const back = () => { if (busy) return; if (pinFor) { setPinFor(null); setError(false); } else onClose(); };

  const pinField = (label: string, value: string, onChange: (value: string) => void, autoFocus: boolean) => <View style={styles.pinField}>
    <Text style={styles.pinLabel}>{label}</Text>
    <TextInput value={value} onChangeText={(text) => onChange(text.replace(/\D/g, "").slice(0, 6))} autoFocus={autoFocus}
      keyboardType="number-pad" secureTextEntry maxLength={6} editable={!busy} accessibilityLabel={label}
      style={styles.pinInput} placeholderTextColor={phoneColors.textMuted} placeholder="••••••" />
  </View>;

  return <Modal transparent visible animationType="slide" onRequestClose={back} statusBarTranslucent navigationBarTranslucent>
    <Pressable accessibilityRole="button" accessibilityLabel={t("close")} style={styles.scrim} onPress={() => { if (!busy) onClose(); }} />
    <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.handle} />
      {pinFor ? <View>
        <View style={styles.profile}>
          <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel={t("back")} onPress={back}><Text style={styles.back}>‹</Text></Pressable>
          <PhoneProfileAvatar api={api} profile={pinFor} size={44} />
          <View style={styles.flex}><Text style={styles.name}>{pinFor.name}</Text><Text style={styles.caption}>{t("switchProfile")}</Text></View>
        </View>
        {pinFor.has_pin ? pinField(t("enterProfilePin"), profilePin, setProfilePin, true) : null}
        {needsChildLock ? pinField(t("enterChildLockPin"), childLockPin, setChildLockPin, !pinFor.has_pin) : null}
        {error ? <Text style={styles.error}>{t("invalidPin")}</Text> : null}
        <View style={styles.pinActions}>
          {busy ? <ActivityIndicator color={phoneColors.text} accessibilityLabel={t("switchingProfile")} />
            : <PhoneChip primary label={t("switchProfile")} disabled={!pinComplete} onPress={() => void perform(pinFor)} />}
        </View>
      </View> : <ScrollView>
        <View style={styles.profile}>
          <PhoneProfileAvatar api={api} profile={active} size={44} />
          <View style={styles.flex}><Text style={styles.name}>{active.name}</Text><Text style={styles.caption}>{incognito ? t("incognitoMode") : t("currentProfile")}</Text></View>
        </View>
        {!active.is_child ? <PhoneListRow title={t("incognitoMode")} detail={t("incognitoModeHint")}
          trailing={<Switch value={incognito} onValueChange={state.onIncognitoChange}
            trackColor={{ true: phoneColors.accent, false: phoneColors.surfaceRaised }} thumbColor={phoneColors.text} />} /> : null}
        <PhoneListRow icon={<SidebarIcon name="history" color={phoneColors.text} size={22} />} title={t("navHistory")} onPress={onHistory} />
        <PhoneListRow icon={<SidebarIcon name="settings" color={phoneColors.text} size={22} />} title={t("navSettings")} onPress={onSettings} />
        {others.length > 0 ? <>
          <PhoneSectionTitle title={t("switchProfile")} />
          {others.map((profile) => <PhoneListRow key={profile.id} title={profile.name}
            detail={profile.pin_locked ? t("profileLocked") : profile.has_pin ? "PIN" : undefined}
            icon={<PhoneProfileAvatar api={api} profile={profile} size={26} />}
            trailing={busy ? <ActivityIndicator color={phoneColors.textMuted} /> : undefined}
            onPress={profile.pin_locked ? undefined : () => choose(profile)} />)}
          {error ? <Text style={styles.error}>{t("actionFailed")}</Text> : null}
        </> : null}
      </ScrollView>}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { maxHeight: "85%", backgroundColor: phoneColors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8 },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: phoneColors.surfaceRaised, marginBottom: 8 },
  profile: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: phoneColors.divider, marginBottom: 6 },
  flex: { flex: 1 },
  back: { color: phoneColors.text, fontSize: 32, lineHeight: 34, paddingRight: 4 },
  avatarImage: { backgroundColor: phoneColors.surfaceRaised },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  initial: { color: "#fff", fontWeight: "700" },
  name: { ...phoneType.title, fontSize: 17, color: phoneColors.text },
  caption: { ...phoneType.caption, color: phoneColors.textMuted },
  pinField: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  pinLabel: { ...phoneType.body, color: phoneColors.text },
  pinInput: { height: 48, borderRadius: 12, paddingHorizontal: 16, backgroundColor: phoneColors.surfaceRaised, color: phoneColors.text, fontSize: 22, letterSpacing: 8 },
  pinActions: { flexDirection: "row", justifyContent: "flex-end", padding: 16 },
  error: { ...phoneType.body, color: phoneColors.danger, paddingHorizontal: 16, paddingTop: 8 },
});
