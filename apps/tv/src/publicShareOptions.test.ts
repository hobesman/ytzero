import { describe, expect, test } from "bun:test";
import { translator } from "./i18n";
import {
  shareExpiryLabel, shareExpiryOptions, shareInactiveReason, sharePlayLimitLabel, sharePlayLimitOptions, sharePlaysLabel,
} from "./publicShareOptions";
import { shareOptionMessages } from "./shareOptionMessages";

const t = translator("en");

describe("YT Zero link options", () => {
  test("play limits list the presets plus a custom limit set elsewhere", () => {
    expect(sharePlayLimitOptions(null, t).map((option) => option.value)).toEqual(["none", "1", "5", "10", "25", "50", "100"]);
    expect(sharePlayLimitOptions(7, t).map((option) => option.value)).toEqual(["none", "1", "5", "7", "10", "25", "50", "100"]);
    expect(sharePlayLimitLabel(null, t)).toBe("No limit");
    expect(sharePlayLimitLabel(1, t)).toBe("1 play");
    expect(sharePlayLimitLabel(25, t)).toBe("25 plays");
  });

  test("expiry choices are durations from now and never", () => {
    expect(shareExpiryOptions(t)).toEqual([
      { value: "1", label: "In 1 hour" }, { value: "24", label: "In 1 day" }, { value: "48", label: "In 2 days" },
      { value: "168", label: "In 7 days" }, { value: "720", label: "In 30 days" }, { value: "none", label: "Never" },
    ]);
  });

  test("expiry and play counts describe the link", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    expect(shareExpiryLabel({ expires_at: null }, t, "en-US", now)).toBe("Never");
    expect(shareExpiryLabel({ expires_at: "2026-11-18T12:00:00Z" }, t, "en-US", now)).toStartWith("On ");
    expect(shareExpiryLabel({ expires_at: "2026-11-15T12:00:00Z" }, t, "en-US", now)).toStartWith("Expired on ");
    expect(sharePlaysLabel({ max_plays: 10, play_count: 3 }, t)).toBe("3 of 10 plays used");
    expect(sharePlaysLabel({ max_plays: 10, play_count: 12 }, t)).toBe("10 of 10 plays used");
    expect(sharePlaysLabel({ max_plays: null, play_count: 4 }, t)).toBe("4 plays so far");
  });

  test("an inactive link says why it can't be shared", () => {
    expect(shareInactiveReason({ active: true, suspension_reason: null }, t)).toBeNull();
    expect(shareInactiveReason({ active: false, suspension_reason: "expired" }, t)).toStartWith("Expired. ");
    expect(shareInactiveReason({ active: false, suspension_reason: "plays_exhausted" }, t)).toStartWith("Play limit reached. ");
    expect(shareInactiveReason({ active: false, suspension_reason: "resource_unavailable" }, t)).toBe("This video can't be shared from YT Zero.");
  });

  test("every language has every string with its placeholders", () => {
    const english = shareOptionMessages.en;
    for (const [language, messages] of Object.entries(shareOptionMessages)) {
      expect(Object.keys(messages).sort()).toEqual(Object.keys(english).sort());
      for (const [key, text] of Object.entries(messages)) {
        expect(text.trim()).not.toBe("");
        const placeholders = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
        expect([language, key, placeholders(text)]).toEqual([language, key, placeholders(english[key as keyof typeof english])]);
      }
    }
  });
});
