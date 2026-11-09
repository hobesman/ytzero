import { ActivityIndicator } from "react-native";
import type { Translate } from "../i18n";
import { appUpdatesAvailable, useAppUpdate } from "../useAppUpdate";
import { PhoneListRow, PhoneSectionTitle } from "./PhoneList";
import { phoneColors } from "./phoneTheme";

/** Settings: the installed build and the newest one published on GitHub. */
export function PhoneAppUpdateSettings({ t }: { t: Translate }) {
  const { state, installed, check, install } = useAppUpdate();
  if (!appUpdatesAvailable) return null;
  const version = installed === null ? t("appLocalBuild") : t("appBuild").replace("{build}", String(installed));
  return <>
    <PhoneSectionTitle title={t("appUpdates")} />
    <PhoneListRow title={t("installedVersion")} detail={version} />
    {state.status === "available"
      ? <PhoneListRow title={t("updateAvailable")} detail={t("updateAvailableHint").replace("{build}", String(state.release.build))} onPress={install} />
      : state.status === "checking"
        ? <PhoneListRow title={t("updateChecking")} trailing={<ActivityIndicator color={phoneColors.textMuted} />} />
        : <PhoneListRow title={t("checkForUpdates")} detail={state.status === "failed" ? t("updateCheckFailed") : t("updateUpToDate")} onPress={check} />}
  </>;
}

/** The avatar menu's entry, shown only while a newer build is waiting. */
export function PhoneAppUpdateEntry({ t }: { t: Translate }) {
  const { state, install } = useAppUpdate();
  if (!appUpdatesAvailable || state.status !== "available") return null;
  return <PhoneListRow title={t("updateAvailable")} detail={t("appBuild").replace("{build}", String(state.release.build))} onPress={install} />;
}
