import { describe, expect, test } from "bun:test";
import { LANGUAGE_CODES } from "../../../shared/uiLanguages";
import { DEVICE_WORDING_KEYS, deviceWording, withDeviceWording } from "./deviceWording";
import { translator, type Translate } from "./i18n";
import type { Language } from "./types";

describe("device wording", () => {
  test("every language rewords every key, without mentioning a television", () => {
    for (const language of LANGUAGE_CODES as readonly Language[]) {
      const wording = deviceWording[language];
      expect(Object.keys(wording).sort()).toEqual([...DEVICE_WORDING_KEYS].sort());
      for (const key of DEVICE_WORDING_KEYS) {
        expect(wording[key].trim().length).toBeGreaterThan(0);
        expect(wording[key]).not.toBe(translator(language)(key));
      }
    }
    expect(Object.values(deviceWording.en).join(" ")).not.toMatch(/television/i);
  });

  test("phones get the device wording; televisions and other keys are unchanged", () => {
    const t = translator("en");
    const phone: Translate = withDeviceWording(t, "en", false);
    expect(phone("pairTitle")).toBe("Pair this device");
    expect(phone("signOut")).toBe(t("signOut"));
    expect(withDeviceWording(t, "en", true)).toBe(t);
  });
});
