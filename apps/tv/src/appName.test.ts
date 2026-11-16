import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LANGUAGE_CODES } from "../../../shared/uiLanguages";
import { buildBranding, withAppName } from "./branding";
import { withDeviceWording } from "./deviceWording";
import { translator, type TranslationKey } from "./i18n";
import type { Language } from "./types";

// Messages that name the app, from several catalogs.
const NAMED: TranslationKey[] = ["booting", "instanceTitle", "cannotConnect", "updateNotifyTitle", "updatePermission", "shareFailed"];

describe("app name in messages", () => {
  test("fills the {app} placeholder", () => {
    expect(withAppName("Connect to {app}", "Hoban Tube")).toBe("Connect to Hoban Tube");
    expect(withAppName("{app} and {app}", "X")).toBe("X and X");
  });

  test("every language names the built-in app and leaves no placeholder", () => {
    for (const language of LANGUAGE_CODES as readonly Language[]) {
      const t = translator(language);
      for (const key of NAMED) {
        expect(t(key)).toContain(buildBranding.name);
        expect(t(key)).not.toContain("{app}");
      }
      const phone = withDeviceWording(t, language, false);
      expect(phone("instanceDescription")).toContain(buildBranding.name);
      expect(phone("discoveryIntro")).not.toContain("{app}");
    }
  });

  test("message catalogs don't hard-code the default name", () => {
    const catalogs = readdirSync(import.meta.dir).filter((file) => /(Messages|i18n|deviceWording)\.ts$/.test(file));
    expect(catalogs.length).toBeGreaterThan(5);
    for (const file of catalogs) {
      expect({ file, named: /YT[ -]Zero/.test(readFileSync(join(import.meta.dir, file), "utf8")) }).toEqual({ file, named: false });
    }
  });
});
