import * as SecureStore from "expo-secure-store";
import { deviceStore, legacyDeviceStore } from "./deviceStore";
import { connectionStorage } from "./connectionStorage";
import { savedProfiles } from "./savedProfiles";
import { localProgressStore } from "./localProgress";
import { systemProfilesNative } from "./systemProfilesNative";
export type { StoredConnection } from "./connectionStorage";

// An installation-local preference namespace, never an authentication secret.
const storage = connectionStorage(SecureStore, deviceStore, () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, systemProfilesNative.available ? legacyDeviceStore : undefined);
export const loadConnection = storage.load;
export const saveConnection = storage.save;
export const clearAccessToken = storage.clearToken;
// Phones keep a sign-in per paired profile (see savedProfiles.ts), only in this app's SecureStore.
export const savedProfileStore = savedProfiles(SecureStore);
// Watch positions not yet confirmed by the server (see localProgress.ts), in this app's SecureStore.
export const localProgress = localProgressStore(SecureStore);
