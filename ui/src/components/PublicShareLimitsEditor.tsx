import { RotateCcw } from "lucide-react";
import type { ManagedPublicShare, PublicShareUpdate } from "../api";
import { useI18n } from "../i18n";
import { Alert, Button, Field, Inline, SelectMenu, SettingRow, Stack, Switch } from "./ui";

const PLAY_LIMIT_PRESETS = [1, 5, 10, 25, 50, 100] as const;
const EXPIRY_PRESET_HOURS = [1, 24, 48, 168, 720] as const;

type Translate = ReturnType<typeof useI18n>["t"];

function playLimitLabel(count: number | null, t: Translate): string {
  if (count == null) return t("publicSharePlayLimitNone");
  return count === 1 ? t("publicSharePlayLimitOne") : t("publicSharePlayLimitCount", { count });
}

function expiryPresetLabel(hours: number, t: Translate): string {
  if (hours === 1) return t("publicShareExpiryOneHour");
  if (hours === 24) return t("publicShareExpiryOneDay");
  return t("publicShareExpiryDays", { count: hours / 24 });
}

export function publicShareExpiryLabel(share: ManagedPublicShare, t: Translate, locale: string, timeZone: string): string {
  if (!share.expires_at) return t("publicShareExpiryNever");
  const at = new Date(share.expires_at);
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(at);
  return at.getTime() <= Date.now() ? t("publicShareExpiredAt", { time }) : t("publicShareExpiryAt", { time });
}

export function publicSharePlaysLabel(share: ManagedPublicShare, t: Translate): string {
  return share.max_plays == null
    ? t("publicSharePlaysCounted", { used: share.play_count })
    : t("publicSharePlaysUsed", { used: Math.min(share.play_count, share.max_plays), max: share.max_plays });
}

/** Server streaming grant plus the play and time limits of one public link. */
export default function PublicShareLimitsEditor({ share, disabled, settingsLayout, onUpdate }: {
  share: ManagedPublicShare;
  disabled: boolean;
  settingsLayout: boolean;
  onUpdate: (update: PublicShareUpdate, success?: string) => void;
}) {
  const { t, locale, timeZone } = useI18n();

  const playOptions = [
    { value: "none", label: t("publicSharePlayLimitNone") },
    ...[...new Set<number>([...PLAY_LIMIT_PRESETS, ...(share.max_plays == null ? [] : [share.max_plays])])]
      .sort((left, right) => left - right)
      .map((count) => ({ value: String(count), label: playLimitLabel(count, t) })),
  ];
  const expiryOptions = [
    { value: "current", label: publicShareExpiryLabel(share, t, locale, timeZone) },
    ...(share.expires_at ? [{ value: "none", label: t("publicShareExpiryNever") }] : []),
    ...EXPIRY_PRESET_HOURS.map((hours) => ({ value: String(hours), label: expiryPresetLabel(hours, t) })),
  ];

  const streamControl = <Switch
    checked={share.allow_server_stream}
    disabled={disabled}
    ariaLabel={settingsLayout ? t("publicShareServerStream") : undefined}
    label={settingsLayout ? undefined : t("publicShareServerStream")}
    description={settingsLayout ? undefined : t("publicShareServerStreamHint")}
    onCheckedChange={(allowed) => onUpdate({ allow_server_stream: allowed }, allowed ? t("publicShareTokenRotated") : undefined)}
  />;
  const warning = share.allow_server_stream && <Alert variant="warning">{t("publicShareServerStreamWarning")}</Alert>;
  const playControl = <Inline gap={2} wrap={false}>
    <SelectMenu
      floating
      size="sm"
      label={t("publicSharePlayLimit")}
      value={share.max_plays == null ? "none" : String(share.max_plays)}
      options={playOptions}
      disabled={disabled}
      onChange={(value) => onUpdate({ max_plays: value === "none" ? null : Number(value) }, t("publicShareLimitsUpdated"))}
    />
    {share.play_count > 0 && <Button size="sm" disabled={disabled} leadingIcon={<RotateCcw />} onClick={() => onUpdate({ reset_plays: true }, t("publicSharePlaysReset"))}>
      {t("publicShareResetPlays")}
    </Button>}
  </Inline>;
  const expiryControl = <SelectMenu
    floating
    size="sm"
    label={t("publicShareExpiry")}
    value="current"
    options={expiryOptions}
    disabled={disabled}
    onChange={(value) => {
      if (value === "current") return;
      onUpdate({ expires_in_hours: value === "none" ? null : Number(value) }, t("publicShareLimitsUpdated"));
    }}
  />;
  const playsDescription = <>{publicSharePlaysLabel(share, t)}. {t("publicSharePlayLimitHint")}</>;

  if (settingsLayout) return <>
    <SettingRow label={t("publicShareServerStream")} description={t("publicShareServerStreamHint")}>{streamControl}</SettingRow>
    {warning}
    <SettingRow label={t("publicSharePlayLimit")} description={playsDescription}>{playControl}</SettingRow>
    <SettingRow label={t("publicShareExpiry")} description={t("publicShareExpiryHint")}>{expiryControl}</SettingRow>
  </>;

  return <Stack gap={3}>
    {streamControl}
    {warning}
    <Field label={t("publicSharePlayLimit")} hint={playsDescription}>{playControl}</Field>
    <Field label={t("publicShareExpiry")} hint={t("publicShareExpiryHint")}>{expiryControl}</Field>
  </Stack>;
}
