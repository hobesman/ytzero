import { useEffect, useState } from "react";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { musicPlayer } from "../../music/musicPlayer";
import { scheduleSettingWrite } from "../../settingsWriteQueue";
import { SettingRow, Switch } from "../ui";

/** Music volume levelling, on unless the profile turned it off. The music player follows at once. */
export function MusicLevellingSetting({ showToast }: { showToast: (message: string) => void }) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let current = true;
    void api.settings().then(({ settings }) => { if (current) setEnabled(settings.music_volume_leveling !== "0"); }).catch(() => { if (current) setEnabled(true); });
    return () => { current = false; };
  }, []);
  const change = (next: boolean) => {
    setEnabled(next);
    musicPlayer.setLevelling(next);
    scheduleSettingWrite("music_volume_leveling", { music_volume_leveling: next ? "1" : "0" }, {
      onSaved: () => showToast(t("displaySettingsSaved")),
      onError: (error) => {
        setEnabled(!next);
        musicPlayer.setLevelling(!next);
        showToast(error instanceof Error ? error.message : t("error"));
      },
    });
  };
  return <SettingRow label={t("musicLevelling")} description={t("musicLevellingHint")}>
    <Switch checked={enabled ?? true} disabled={enabled === null} onCheckedChange={change} />
  </SettingRow>;
}
