import { getSetting } from "./db";

export const DEFAULT_APP_NAME = "YT Zero";
export const DEFAULT_APP_ICON_COLOR = "#0a5fff";

export function brandFromSettings(setting: (key: string) => string | null | undefined): { name: string; color: string } {
  const color = setting("app_icon_color") || DEFAULT_APP_ICON_COLOR;
  return {
    name: setting("app_name")?.trim() || DEFAULT_APP_NAME,
    color: /^#[\da-f]{6}$/i.test(color) ? color : DEFAULT_APP_ICON_COLOR,
  };
}

/** The instance's name and icon color, shown on pages seen before signing in (login, public shares).
 * Both are already public through /manifest.webmanifest and /favicon.svg. */
export function publicBrand(): { name: string; color: string } {
  return brandFromSettings(getSetting);
}
