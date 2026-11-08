import { describe, expect, test } from "bun:test";
import { SAVED_PROFILES_KEY, savedProfiles, type SavedProfile } from "./savedProfiles";

function memoryStore() {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { values.set(key, value); },
    deleteItemAsync: async (key: string) => { values.delete(key); },
  };
}
const profile = (profileId: number, instanceUrl = "https://tube.example.com"): SavedProfile =>
  ({ instanceUrl, profileId, name: `P${profileId}`, avatar: "", avatarColor: "#123456", accessToken: `token-${profileId}` });

describe("saved profiles", () => {
  test("keeps one sign-in per profile, most recent first", async () => {
    const store = memoryStore();
    const saved = savedProfiles(store);
    await saved.remember(profile(1));
    await saved.remember(profile(2));
    await saved.remember({ ...profile(1), accessToken: "token-1b" });
    expect((await saved.list("https://tube.example.com")).map((entry) => [entry.profileId, entry.accessToken]))
      .toEqual([[1, "token-1b"], [2, "token-2"]]);
    expect([...store.values.keys()]).toEqual([SAVED_PROFILES_KEY]);
  });

  test("changing instance drops the previous instance's sign-ins", async () => {
    const saved = savedProfiles(memoryStore());
    await saved.remember(profile(1));
    await saved.remember(profile(7, "https://other.example.com"));
    expect(await saved.list("https://tube.example.com")).toEqual([]);
    expect((await saved.list("https://other.example.com")).map((entry) => entry.profileId)).toEqual([7]);
  });

  test("forgetting the last profile removes the stored key", async () => {
    const store = memoryStore();
    const saved = savedProfiles(store);
    await saved.remember(profile(1));
    await saved.forget("https://tube.example.com", 1);
    expect(store.values.size).toBe(0);
  });

  test("ignores corrupt or tokenless entries", async () => {
    const store = memoryStore();
    store.values.set(SAVED_PROFILES_KEY, JSON.stringify({ version: 1, profiles: [{ ...profile(1), accessToken: "" }, { nope: true }, profile(2)] }));
    expect((await savedProfiles(store).list("https://tube.example.com")).map((entry) => entry.profileId)).toEqual([2]);
    store.values.set(SAVED_PROFILES_KEY, "not json");
    expect(await savedProfiles(store).list("https://tube.example.com")).toEqual([]);
  });
});
