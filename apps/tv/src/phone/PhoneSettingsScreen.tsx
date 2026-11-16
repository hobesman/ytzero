import { useState } from "react";
import { ScrollView, StyleSheet, Switch, Text } from "react-native";
import type { YtZeroApi } from "../api";
import { deviceStore } from "../deviceStore";
import type { Translate } from "../i18n";
import { MusicDownloadWifiSetting } from "../music/MusicDownloadViews";
import { saveStreamQuality, streamQuality } from "../streamQuality";
import { saveLowResource, useLowResource } from "../lowResource";
import { PhoneBufferSetting } from "./PhoneBufferSetting";
import { PhoneProfilePlaybackSettings } from "./PhoneProfilePlaybackSettings";
import { PhoneAppUpdateSettings } from "./PhoneAppUpdateSettings";
import { PhoneDownloadSettings } from "./PhoneDownloadSettings";
import { PhoneGroupTitle, PhoneListRow } from "./PhoneList";
import { phoneColors, phoneType } from "./phoneTheme";

export type PhoneSettings = {
  instanceUrl: string;
  /** Whether this profile may use music mode; its group is left out when not. */
  music: boolean;
  openDetails: boolean; onOpenDetailsChange: (value: boolean) => Promise<void>;
  phoneLayout: boolean; onPhoneLayoutChange: (value: boolean) => Promise<void>;
  landscapeLayout: boolean; onLandscapeLayoutChange: (value: boolean) => Promise<void>;
  onChangeInstance: () => Promise<void>; onSignOut: () => Promise<void>;
};

/**
 * This device's settings, in the phone layout, and the same screen in music
 * and video mode: what applies to both, then music, then video, then the
 * app and its connection.
 */
export function PhoneSettingsScreen({ api, settings, t }: { api: YtZeroApi; settings: PhoneSettings; t: Translate }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const lowResource = useLowResource();
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
    <PhoneGroupTitle title={t("settingsGroupGeneral")} />
    <PhoneListRow title={t("phoneLayout")} detail={t("phoneLayoutHint")} trailing={toggle(settings.phoneLayout, settings.onPhoneLayoutChange)} />
    <PhoneListRow title={t("landscapeLayout")} detail={t("landscapeLayoutHint")} trailing={toggle(settings.landscapeLayout, settings.onLandscapeLayoutChange)} />
    <PhoneListRow title={t("lowResource")} detail={t("lowResourceHint")} trailing={toggle(lowResource, (value) => saveLowResource(deviceStore, value))} />

    {settings.music ? <>
      <PhoneGroupTitle title={t("settingsGroupMusic")} />
      <PhoneProfilePlaybackSettings api={api} t={t} group="music" />
      <MusicDownloadWifiSetting t={t} />
    </> : null}

    <PhoneGroupTitle title={t("settingsGroupVideo")} />
    <PhoneProfilePlaybackSettings api={api} t={t} group="video" />
    <PhoneListRow title={t("qualityFast")} detail={t("qualityFastHint")} trailing={toggle(fastStart, changeFastStart)} />
    <PhoneBufferSetting t={t} onError={() => setFailed(true)} />
    <PhoneDownloadSettings t={t} />

    <PhoneGroupTitle title={t("settingsGroupSystem")} />
    <PhoneListRow title={t("currentInstance")} detail={settings.instanceUrl} />
    <PhoneListRow title={t("changeInstance")} onPress={() => void run(settings.onChangeInstance)} />
    <PhoneListRow title={t("signOut")} detail={t("signOutHint")} danger onPress={() => void run(settings.onSignOut)} />
    <PhoneAppUpdateSettings t={t} />
    {failed ? <Text style={styles.error}>{t("cannotConnect")}</Text> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  error: { ...phoneType.body, color: phoneColors.danger, padding: 16 },
});
