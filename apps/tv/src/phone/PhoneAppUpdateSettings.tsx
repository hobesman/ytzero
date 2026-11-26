import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Switch, Text } from "react-native";
import type { Translate } from "../i18n";
import { appUpdatesAvailable, useAppUpdate, type AppUpdateState } from "../useAppUpdate";
import { PhoneListRow, PhoneSectionTitle } from "./PhoneList";
import { phoneColors, phoneType } from "./phoneTheme";

type Row = { title: string; detail?: string; spinner?: boolean; percent?: string; pressable: boolean };

/** What the update row says in each state; shared by Settings and the avatar menu. */
function updateRow(state: AppUpdateState, t: Translate, installsItself: boolean): Row {
  const build = "release" in state ? String(state.release.build) : "";
  const fill = (key: Parameters<Translate>[0]) => t(key).replace("{build}", build);
  switch (state.status) {
    case "checking": return { title: t("updateChecking"), spinner: true, pressable: false };
    case "failed": return { title: t("checkForUpdates"), detail: t("updateCheckFailed"), pressable: true };
    case "current": return { title: t("checkForUpdates"), detail: t("updateUpToDate"), pressable: true };
    case "available": return {
      title: t("updateAvailable"), pressable: true,
      detail: state.problem === "corrupt" ? t("updateDownloadCorrupt") : state.problem === "download" ? t("updateDownloadFailed")
        : installsItself ? fill("updateDownloadHint") : fill("updateAvailableHint"),
    };
    case "downloading": return {
      title: fill("updateDownloading"), spinner: true, pressable: state.background,
      percent: state.fraction === null ? undefined : `${Math.round(state.fraction * 100)}%`,
      detail: state.background ? t("updateDownloadingBackground") : t("updateDownloadingHint"),
    };
    case "ready": return { title: fill("updateInstall"), detail: state.problem ? t("updateInstallFailed") : t("updateInstallHint"), pressable: true };
    case "permission": return { title: t("updatePermission"), detail: t("updatePermissionHint"), pressable: true };
    case "installing": return { title: t("updateInstalling"), detail: t("updateInstallingHint"), spinner: true, pressable: false };
  }
}

function UpdateRow({ row, onPress }: { row: Row; onPress: () => void }) {
  const trailing = row.percent ? <Text style={styles.value}>{row.percent}</Text>
    : row.spinner ? <ActivityIndicator color={phoneColors.textMuted} /> : undefined;
  return <PhoneListRow title={row.title} detail={row.detail} trailing={trailing} onPress={row.pressable ? onPress : undefined} />;
}

/** Settings: the installed build, the newest one on GitHub, and whether new ones download by themselves. */
export function PhoneAppUpdateSettings({ t }: { t: Translate }) {
  const { state, installed, autoDownload, act, check, setAutoDownload, installsItself } = useAppUpdate(t);
  // Opening Settings shows the newest build, not one found up to an hour ago.
  useEffect(() => { if (appUpdatesAvailable) check(); }, [check]);
  if (!appUpdatesAvailable) return null;
  const version = installed === null ? t("appLocalBuild") : t("appBuild").replace("{build}", String(installed));
  return <>
    <PhoneSectionTitle title={t("appUpdates")} />
    <PhoneListRow title={t("installedVersion")} detail={version} />
    <UpdateRow row={updateRow(state, t, installsItself)} onPress={act} />
    {installsItself ? <PhoneListRow title={t("updateAuto")} detail={t("updateAutoHint")} trailing={<Switch value={autoDownload}
      onValueChange={(value) => void setAutoDownload(value).catch(() => {})} trackColor={{ true: phoneColors.accent, false: phoneColors.surfaceRaised }} thumbColor={phoneColors.text} />} /> : null}
  </>;
}

/** The avatar menu's entry, shown only while a newer build is waiting, downloading or ready. */
export function PhoneAppUpdateEntry({ t }: { t: Translate }) {
  const { state, act, installsItself } = useAppUpdate(t);
  if (!appUpdatesAvailable || state.status === "checking" || state.status === "failed" || state.status === "current") return null;
  return <UpdateRow row={updateRow(state, t, installsItself)} onPress={act} />;
}

const styles = StyleSheet.create({
  value: { ...phoneType.body, color: phoneColors.textMuted },
});
