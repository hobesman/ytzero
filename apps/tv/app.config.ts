import type { ConfigContext, ExpoConfig } from "expo/config";

// app.json holds the configuration. The "Android APK" workflow sets
// EXPO_PUBLIC_ANDROID_BUILD so every published APK gets a higher versionCode
// than the one before it, which Android requires to install it as an update.
export default ({ config }: ConfigContext): ExpoConfig => {
  const build = Number(process.env.EXPO_PUBLIC_ANDROID_BUILD);
  if (!Number.isSafeInteger(build) || build <= 0) return config as ExpoConfig;
  return { ...config, android: { ...config.android, versionCode: build } } as ExpoConfig;
};
