import type { ConfigContext, ExpoConfig } from "expo/config";
// Expo loads this file with plain Node, which can't import other .ts files,
// so the name is read from the JSON here rather than through src/branding.ts.
import branding from "./branding.json";

// app.json holds the configuration. The "Android APK" workflow sets
// EXPO_PUBLIC_ANDROID_BUILD so every published APK gets a higher versionCode
// than the one before it, which Android requires to install it as an update.
// The app's name under its icon comes from branding.json.
export default ({ config }: ConfigContext): ExpoConfig => {
  const name = typeof branding.name === "string" && branding.name.trim() ? branding.name.trim().slice(0, 60) : "YT Zero";
  const named = { ...config, name } as ExpoConfig;
  const build = Number(process.env.EXPO_PUBLIC_ANDROID_BUILD);
  if (!Number.isSafeInteger(build) || build <= 0) return named;
  return { ...named, android: { ...named.android, versionCode: build } } as ExpoConfig;
};
