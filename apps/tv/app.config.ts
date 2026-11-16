import type { ConfigContext, ExpoConfig } from "expo/config";
import { buildBranding } from "./src/branding";

// app.json holds the configuration. The "Android APK" workflow sets
// EXPO_PUBLIC_ANDROID_BUILD so every published APK gets a higher versionCode
// than the one before it, which Android requires to install it as an update.
// The app's name under its icon comes from branding.json.
export default ({ config }: ConfigContext): ExpoConfig => {
  const named = { ...config, name: buildBranding.name } as ExpoConfig;
  const build = Number(process.env.EXPO_PUBLIC_ANDROID_BUILD);
  if (!Number.isSafeInteger(build) || build <= 0) return named;
  return { ...named, android: { ...named.android, versionCode: build } } as ExpoConfig;
};
