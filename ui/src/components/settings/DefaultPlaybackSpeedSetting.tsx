import { resolvePlaybackSpeeds, serializeCustomPlaybackSpeeds } from "../../../../shared/playbackSpeeds";
import { useI18n } from "../../i18n";
import { SelectMenu, SettingRow, Switch } from "../ui";

/** The profile's default speed, and whether a speed chosen in a player replaces it. */
export function DefaultPlaybackSpeedSetting({ speed, customSpeeds, remember, onSpeedChange, onRememberChange, save }: {
  speed: string; customSpeeds: readonly string[]; remember: boolean;
  onSpeedChange: (next: string) => void; onRememberChange: (next: boolean) => void;
  save: (patch: Record<string, string>) => unknown;
}) {
  const { t } = useI18n();
  return <>
    <SettingRow label={t("playbackSpeed")} description={t("playbackSpeedHint")}>
      <SelectMenu
        label={t("playbackSpeed")}
        value={speed}
        options={resolvePlaybackSpeeds(serializeCustomPlaybackSpeeds([...customSpeeds]), speed).map((value) => ({ value, label: `${value}×` }))}
        onChange={(next) => { onSpeedChange(next); void save({ player_speed: next }); }}
      />
    </SettingRow>
    <SettingRow label={t("rememberPlaybackSpeed")} description={t("rememberPlaybackSpeedHint")}>
      <Switch checked={remember} onCheckedChange={(next) => { onRememberChange(next); void save({ player_speed_remember: next ? "1" : "0" }); }} />
    </SettingRow>
  </>;
}
