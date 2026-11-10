import { useState } from "react";
import { ScrollView, StyleSheet, Switch, Text } from "react-native";
import type { YtZeroApi } from "../api";
import { deviceStore } from "../deviceStore";
import type { Translate } from "../i18n";
import { saveStreamQuality, streamQuality } from "../streamQuality";
import { PhoneProfilePlaybackSettings } from "./PhoneProfilePlaybackSettings";
import { PhoneAppUpdateSettings } from "./PhoneAppUpdateSettings";
import { PhoneDownloadSettings } from "./PhoneDownloadSettings";
import { PhoneListRow, PhoneSectionTitle } from "./PhoneList";
import { phoneColors, phoneType } from "./phoneTheme";

export type PhoneSettings = {
  instanceUrl: string;
  openDetails: boolean; onOpenDetailsChange: (value: boolean) => Promise<void>;
  phoneLayout: boolean; onPhoneLayoutChange: (value: boolean) => Promise<void>;
  onChangeInstance: () => Promise<void>; onSignOut: () => Promise<void>;
};

/** This device's settings, in the phone layout. */
export function PhoneSettingsScreen({ api, settings, t }: { api: YtZeroApi; settings: PhoneSettings; t: Translate }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // The same device choice as the player's quality menu: on is "fast", off is "auto".
  const [fastStart, setFastStart] = useState(() => streamQuality() === "fast");
  const changeFastStart = async (value: boolean) => {
    await saveStreamQuality(deviceStore, value ? "fast" : "auto");
    setFastStart(value);
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setFailed(false);
    try { await action(); } catch { setFailed(true); } finally { setBusy(false); }
  };
  const toggle = (value: boolean, onChange: (value: boolean) => Promise<void>) => <Switch value={value} disabled={busy}
    onValueChange={(next) => void run(() => onChange(next))} trackColor={{ true: phoneColors.accent, false: phoneColors.surfaceRaised }} thumbColor={phoneColors.text} />;
  return <ScrollView contentContainerStyle={styles.content}>
    <PhoneSectionTitle title={t("devicePlayback")} />
    <PhoneProfilePlaybackSettings api={api} t={t} />
    <PhoneListRow title={t("qualityFast")} detail={t("qualityFastHint")} trailing={toggle(fastStart, changeFastStart)} />
    <PhoneListRow title={t("phoneLayout")} detail={t("phoneLayoutHint")} trailing={toggle(settings.phoneLayout, settings.onPhoneLayoutChange)} />
    <PhoneDownloadSettings t={t} />
    <PhoneSectionTitle title={t("connection")} />
    <PhoneListRow title={t("currentInstance")} detail={settings.instanceUrl} />
    <PhoneListRow title={t("changeInstance")} onPress={() => void run(settings.onChangeInstance)} />
    <PhoneSectionTitle title={t("session")} />
    <PhoneListRow title={t("signOut")} detail={t("signOutHint")} danger onPress={() => void run(settings.onSignOut)} />
    <PhoneAppUpdateSettings t={t} />
    {failed ? <Text style={styles.error}>{t("cannotConnect")}</Text> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  error: { ...phoneType.body, color: phoneColors.danger, padding: 16 },
});
