import type { Translate } from "./i18n";

/** A profile's public YT Zero link, as the server's share management API returns it. */
export type PublicShare = {
  id: string;
  url: string;
  active: boolean;
  suspension_reason: string | null;
  allow_server_stream: boolean;
  max_plays: number | null;
  play_count: number;
  expires_at: string | null;
};

/** A change to a link: streaming, a play limit (null: none), an expiry in hours from now (null: never). */
export type PublicShareUpdate = {
  allow_server_stream?: boolean;
  max_plays?: number | null;
  expires_in_hours?: number | null;
  reset_plays?: boolean;
};

/** The same choices as the web app's share editor. */
export const SHARE_PLAY_LIMITS = [1, 5, 10, 25, 50, 100] as const;
export const SHARE_EXPIRY_HOURS = [1, 24, 48, 168, 720] as const;

export function sharePlayLimitLabel(count: number | null, t: Translate): string {
  if (count == null) return t("sharePlayLimitNone");
  return count === 1 ? t("sharePlayLimitOne") : t("sharePlayLimitCount").replace("{count}", String(count));
}

/** The play limit choices, including a custom limit set on the web. */
export function sharePlayLimitOptions(current: number | null, t: Translate): { value: string; label: string }[] {
  const counts = [...new Set<number>([...SHARE_PLAY_LIMITS, ...(current == null ? [] : [current])])].sort((a, b) => a - b);
  return [{ value: "none", label: t("sharePlayLimitNone") }, ...counts.map((count) => ({ value: String(count), label: sharePlayLimitLabel(count, t) }))];
}

export function shareExpiryPresetLabel(hours: number, t: Translate): string {
  if (hours === 1) return t("shareExpiryOneHour");
  if (hours === 24) return t("shareExpiryOneDay");
  return t("shareExpiryDays").replace("{count}", String(hours / 24));
}

/** The expiry choices: durations from now, and "never". */
export function shareExpiryOptions(t: Translate): { value: string; label: string }[] {
  return [...SHARE_EXPIRY_HOURS.map((hours) => ({ value: String(hours), label: shareExpiryPresetLabel(hours, t) })),
    { value: "none", label: t("shareExpiryNever") }];
}

/** When the link expires or expired, in the device's language. */
export function shareExpiryLabel(share: Pick<PublicShare, "expires_at">, t: Translate, locale: string, now = Date.now()): string {
  if (!share.expires_at) return t("shareExpiryNever");
  const at = new Date(share.expires_at);
  if (!Number.isFinite(at.getTime())) return t("shareExpiryNever");
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(at);
  return (at.getTime() <= now ? t("shareExpiredAt") : t("shareExpiryAt")).replace("{time}", time);
}

export function sharePlaysLabel(share: Pick<PublicShare, "max_plays" | "play_count">, t: Translate): string {
  return share.max_plays == null
    ? t("sharePlaysCounted").replace("{used}", String(share.play_count))
    : t("sharePlaysUsed").replace("{used}", String(Math.min(share.play_count, share.max_plays))).replace("{max}", String(share.max_plays));
}

/** Why an inactive link can't be shared, or null when it can. */
export function shareInactiveReason(share: Pick<PublicShare, "active" | "suspension_reason">, t: Translate): string | null {
  if (share.active) return null;
  if (share.suspension_reason === "expired") return `${t("shareStatusExpired")}. ${t("shareLinkInactive")}`;
  if (share.suspension_reason === "plays_exhausted") return `${t("shareStatusPlaysExhausted")}. ${t("shareLinkInactive")}`;
  return t("shareUnavailable");
}
