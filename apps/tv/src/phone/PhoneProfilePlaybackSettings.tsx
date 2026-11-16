import { useEffect, useState } from "react";
import { StyleSheet, Switch, Text } from "react-native";
import type { YtZeroApi } from "../api";
import { musicPlayer } from "../musicPlayer";
import type { Translate } from "../i18n";
import { playableSpeed, speedLabel, speedOptions } from "../playbackSpeeds";
import type { TvProfileSettings } from "../types";
import { TvChoiceSheet } from "../components/TvChoiceSheet";
import { PhoneListRow } from "./PhoneList";
import { phoneColors, phoneType } from "./phoneTheme";

type Values = Pick<TvProfileSettings, "player_speed" | "player_speed_remember" | "sponsorblock_enabled" | "music_volume_leveling">;

/**
 * Playback settings that live in the profile on the server, the same ones as
 * the web settings page, so a change here reaches every device. `group`
 * picks the video player's settings or music mode's.
 */
export function PhoneProfilePlaybackSettings({ api, t, group }: { api: YtZeroApi; t: Translate; group: "video" | "music" }) {
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
    // The music player follows at once, not only when music mode next starts.
    if (patch.music_volume_leveling) void musicPlayer.setLevelling(patch.music_volume_leveling !== "0");
    try { await api.updateSettings(patch); } catch {
      setValues(previous);
      setFailed(true);
      if (patch.music_volume_leveling) void musicPlayer.setLevelling(previous.music_volume_leveling !== "0");
    }
  };
  const speed = playableSpeed(values.player_speed) ?? 1;
  const toggle = (value: boolean, key: "player_speed_remember" | "sponsorblock_enabled" | "music_volume_leveling") => <Switch value={value}
    onValueChange={(next) => void save({ [key]: next ? "1" : "0" })} trackColor={{ true: phoneColors.accent, false: phoneColors.surfaceRaised }} thumbColor={phoneColors.text} />;
  if (group === "music") return <>
    {musicPlayer.available ? <PhoneListRow title={t("musicLevelling")} detail={t("musicLevellingHint")}
      trailing={toggle(values.music_volume_leveling !== "0", "music_volume_leveling")} /> : null}
    {failed ? <Text style={styles.error}>{t("cannotConnect")}</Text> : null}
  </>;
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
