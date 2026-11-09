import { useEffect, useState } from "react";
import { StyleSheet, Switch, Text } from "react-native";
import type { YtZeroApi } from "../api";
import type { Translate } from "../i18n";
import { playableSpeed, speedLabel, speedOptions } from "../playbackSpeeds";
import type { TvProfileSettings } from "../types";
import { TvChoiceSheet } from "../components/TvChoiceSheet";
import { PhoneListRow } from "./PhoneList";
import { phoneColors, phoneType } from "./phoneTheme";

type Values = Pick<TvProfileSettings, "player_speed" | "player_speed_remember" | "sponsorblock_enabled">;

/**
 * Playback settings that live in the profile on the server, the same ones as
 * the web settings page, so a change here reaches every device.
 */
export function PhoneProfilePlaybackSettings({ api, t }: { api: YtZeroApi; t: Translate }) {
  const [values, setValues] = useState<Values | null>(null);
  const [speedSheet, setSpeedSheet] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    void api.settings().then(({ settings }) => { if (current) setValues(settings); }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [api]);
  if (!values) return failed ? <Text style={styles.error}>{t("cannotConnect")}</Text> : null;

  const save = async (patch: Values) => {
    const previous = values;
    setValues({ ...values, ...patch });
    setFailed(false);
    try { await api.updateSettings(patch); } catch { setValues(previous); setFailed(true); }
  };
  const speed = playableSpeed(values.player_speed) ?? 1;
  const toggle = (value: boolean, key: "player_speed_remember" | "sponsorblock_enabled") => <Switch value={value}
    onValueChange={(next) => void save({ [key]: next ? "1" : "0" })} trackColor={{ true: phoneColors.accent, false: phoneColors.surfaceRaised }} thumbColor={phoneColors.text} />;
  return <>
    <PhoneListRow title={t("defaultSpeed")} detail={t("defaultSpeedHint")} onPress={() => setSpeedSheet(true)}
      trailing={<Text style={styles.value}>{speedLabel(speed)}</Text>} />
    <PhoneListRow title={t("rememberSpeed")} detail={t("rememberSpeedHint")} trailing={toggle(values.player_speed_remember === "1", "player_speed_remember")} />
    <PhoneListRow title={t("sponsorSkip")} detail={t("sponsorSkipHint")} trailing={toggle(values.sponsorblock_enabled === "1", "sponsorblock_enabled")} />
    {failed ? <Text style={styles.error}>{t("cannotConnect")}</Text> : null}
    {speedSheet ? <TvChoiceSheet title={t("defaultSpeed")} t={t} value={String(speed)}
      options={speedOptions(speed).map((value) => ({ value, label: speedLabel(value) }))}
      onSelect={(value) => { setSpeedSheet(false); void save({ player_speed: value }); }} onClose={() => setSpeedSheet(false)} /> : null}
  </>;
}

const styles = StyleSheet.create({
  value: { ...phoneType.body, color: phoneColors.textMuted },
  error: { ...phoneType.body, color: phoneColors.danger, paddingHorizontal: 16, paddingVertical: 8 },
});
