import type { KeyStore } from "./connectionStorage";
import { normalizeInstanceUrl } from "./instanceUrl";

/**
 * Profile sign-ins kept on a phone, so a device paired to several profiles
 * can switch between them when the instance gives each profile its own login.
 * Each entry is a profile-scoped bearer and lives only in SecureStore.
 */
export const SAVED_PROFILES_KEY = "ytzero.tv.saved-profiles.v1";

export type SavedProfile = {
  instanceUrl: string; profileId: number; name: string; avatar: string; avatarColor: string; accessToken: string;
};

function valid(entry: unknown): entry is SavedProfile {
  if (!entry || typeof entry !== "object") return false;
  const value = entry as Record<string, unknown>;
  return typeof value.instanceUrl === "string" && typeof value.profileId === "number" && typeof value.name === "string"
    && typeof value.avatar === "string" && typeof value.avatarColor === "string" && typeof value.accessToken === "string" && value.accessToken.length > 0;
}

export function savedProfiles(store: KeyStore) {
  const read = async (): Promise<SavedProfile[]> => {
    try {
      const record = JSON.parse(await store.getItemAsync(SAVED_PROFILES_KEY) ?? "null");
      return record?.version === 1 && Array.isArray(record.profiles) ? record.profiles.filter(valid) : [];
    } catch { return []; }
  };
  const write = async (profiles: SavedProfile[]) => {
    if (profiles.length) await store.setItemAsync(SAVED_PROFILES_KEY, JSON.stringify({ version: 1, profiles }));
    else await store.deleteItemAsync(SAVED_PROFILES_KEY);
  };
  const same = (entry: SavedProfile, instanceUrl: string, profileId: number) => entry.instanceUrl === instanceUrl && entry.profileId === profileId;
  return {
    /** The instance's saved profiles, most recently used first. */
    list: async (instanceUrl: string) => {
      const url = normalizeInstanceUrl(instanceUrl);
      return (await read()).filter((entry) => entry.instanceUrl === url);
    },
    /** Saves or refreshes a profile's sign-in. Another instance's sign-ins are dropped. */
    remember: async (profile: SavedProfile) => {
      const entry = { ...profile, instanceUrl: normalizeInstanceUrl(profile.instanceUrl) };
      const others = (await read()).filter((item) => item.instanceUrl === entry.instanceUrl && !same(item, entry.instanceUrl, entry.profileId));
      await write([entry, ...others]);
    },
    forget: async (instanceUrl: string, profileId: number) => {
      const url = normalizeInstanceUrl(instanceUrl);
      await write((await read()).filter((entry) => !same(entry, url, profileId)));
    },
    clear: () => store.deleteItemAsync(SAVED_PROFILES_KEY),
  };
}
