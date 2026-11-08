import { describe, expect, test } from "bun:test";
import { loadOpenDetails, loadPhoneLayout, OPEN_DETAILS_KEY, PHONE_LAYOUT_KEY, saveOpenDetails, savePhoneLayout, shouldPlayVideo } from "./devicePreferences";

describe("device thumbnail preference", () => {
  test("defaults to playback and persists the optional details choice only on this device", async () => {
    const values = new Map<string, string>();
    const store = { getItemAsync: async (key: string) => values.get(key) ?? null, setItemAsync: async (key: string, value: string) => { values.set(key, value); } };
    expect(await loadOpenDetails(store)).toBe(false);
    await saveOpenDetails(store, true);
    expect(await loadOpenDetails(store)).toBe(true);
    expect([...values.keys()]).toEqual([OPEN_DETAILS_KEY]);
    await saveOpenDetails(store, false);
    expect(await loadOpenDetails(store)).toBe(false);
    values.set(OPEN_DETAILS_KEY, "invalid");
    expect(await loadOpenDetails(store)).toBe(false);
  });
  test("explicit Play and Details actions override the preference", () => {
    expect(shouldPlayVideo(false)).toBe(true);
    expect(shouldPlayVideo(true)).toBe(false);
    for (const preference of [true, false]) {
      expect(shouldPlayVideo(preference, true)).toBe(true);
      expect(shouldPlayVideo(preference, false)).toBe(false);
    }
  });
  test("migrates the old device choice when adopting the shared tvOS Keychain", async () => {
    let shared: string | null = null;
    const store = { getItemAsync: async () => shared, setItemAsync: async (_key: string, value: string) => { shared = value; } };
    const legacy = { getItemAsync: async () => "true", setItemAsync: async () => {} };
    expect(await loadOpenDetails(store, legacy)).toBe(true);
    await saveOpenDetails(store, false);
    expect(await loadOpenDetails(store, legacy)).toBe(false);
  });
  test("storage errors propagate so settings cannot claim an unsaved change", async () => {
    await expect(saveOpenDetails({ getItemAsync: async () => null, setItemAsync: async () => { throw new Error("unavailable"); } }, true)).rejects.toThrow("unavailable");
  });
});

describe("phone layout", () => {
  test("follows the device until chosen, then persists only on this device", async () => {
    const values = new Map<string, string>();
    const store = { getItemAsync: async (key: string) => values.get(key) ?? null, setItemAsync: async (key: string, value: string) => { values.set(key, value); } };
    expect(await loadPhoneLayout(store, true)).toBe(true);
    expect(await loadPhoneLayout(store, false)).toBe(false);
    await savePhoneLayout(store, false);
    expect(await loadPhoneLayout(store, true)).toBe(false);
    await savePhoneLayout(store, true);
    expect(await loadPhoneLayout(store, false)).toBe(true);
    expect([...values.keys()]).toEqual([PHONE_LAYOUT_KEY]);
    values.set(PHONE_LAYOUT_KEY, "yes");
    expect(await loadPhoneLayout(store, true)).toBe(true);
  });
});
