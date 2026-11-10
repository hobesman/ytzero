import { useState } from "react";
import { StyleSheet, Switch, Text } from "react-native";
import { TvChoiceSheet } from "../components/TvChoiceSheet";
import type { Translate } from "../i18n";
import { PHONE_DOWNLOAD_QUALITIES, type PhoneDownloadQuality } from "../phoneDownloads";
import { usePhoneDownloads } from "../usePhoneDownloads";
import { PhoneListRow, PhoneSectionTitle } from "./PhoneList";
import { phoneColors, phoneType } from "./phoneTheme";

/** How this phone saves videos: their quality, and whether mobile data may be used. */
export function PhoneDownloadSettings({ t }: { t: Translate }) {
  const store = usePhoneDownloads();
  const [qualitySheet, setQualitySheet] = useState(false);
  if (!store.available) return null;
  const { quality, allowMetered } = store.snapshot();
  const label = (value: PhoneDownloadQuality) => value === "server" ? t("downloadQualityServer") : `${value}p`;
  return <>
    <PhoneSectionTitle title={t("phoneDownloadsSettings")} />
    <PhoneListRow title={t("downloadQuality")} detail={t("downloadQualityHint")} onPress={() => setQualitySheet(true)}
      trailing={<Text style={styles.value}>{label(quality)}</Text>} />
    <PhoneListRow title={t("downloadMobileData")} detail={t("downloadMobileDataHint")} trailing={<Switch value={allowMetered}
      onValueChange={(value) => store.setAllowMetered(value)} trackColor={{ true: phoneColors.accent, false: phoneColors.surfaceRaised }} thumbColor={phoneColors.text} />} />
    {qualitySheet ? <TvChoiceSheet title={t("downloadQuality")} t={t} value={quality}
      options={PHONE_DOWNLOAD_QUALITIES.map((value) => ({ value, label: label(value) }))}
      onSelect={(value) => { setQualitySheet(false); store.setQuality(value as PhoneDownloadQuality); }} onClose={() => setQualitySheet(false)} /> : null}
  </>;
}

const styles = StyleSheet.create({
  value: { ...phoneType.body, color: phoneColors.textMuted },
});
