import built from "../branding.json";

// The app name and icon color baked into this build (branding.json). The
// "Android APK" workflow copies them from the server named by its
// YTZERO_BRANDING_URL variable before building, so the launcher icon, the app
// label and the first screens match that server. Once connected, the app
// switches to the server's current settings.
export const DEFAULT_BRAND_NAME = "YT Zero";
export const DEFAULT_BRAND_COLOR = "#0a5fff";

export function normalizeBranding(value: unknown): { name: string; color: string } {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const name = typeof record.name === "string" ? record.name.trim().slice(0, 60) : "";
  const color = typeof record.color === "string" && /^#[0-9a-f]{6}$/i.test(record.color) ? record.color.toLowerCase() : "";
  return { name: name || DEFAULT_BRAND_NAME, color: color || DEFAULT_BRAND_COLOR };
}

export const buildBranding = normalizeBranding(built);

/** Fills the {app} placeholder the message catalogs use for the app's name. */
export function withAppName(text: string, name = buildBranding.name): string {
  return text.replaceAll("{app}", name);
}

// Reads the branding a server publishes without signing in: the name from
// /manifest.webmanifest and the color of the tile in /favicon.svg (see
// app/src/app-icon.ts). Returns null when either is missing.
export function brandingFromServer(manifest: unknown, faviconSvg: string): { name: string; color: string } | null {
  const name = manifest && typeof manifest === "object" ? (manifest as Record<string, unknown>).name : undefined;
  const color = /<rect\b[^>]*\bfill="(#[0-9a-f]{6})"/i.exec(faviconSvg)?.[1];
  if (typeof name !== "string" || !name.trim() || !color) return null;
  return normalizeBranding({ name, color });
}
