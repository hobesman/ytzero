import { describe, expect, test } from "bun:test";
import { brandFromSettings } from "./publicBrand";

const from = (settings: Record<string, string | null>) => brandFromSettings((key) => settings[key]);

describe("public brand", () => {
  test("uses the instance's name and icon color", () => {
    expect(from({ app_name: "  Hoban Tube ", app_icon_color: "#c7d93f" })).toEqual({ name: "Hoban Tube", color: "#c7d93f" });
  });

  test("falls back to YT Zero for unset or malformed settings", () => {
    expect(from({ app_name: "   ", app_icon_color: "javascript:red" })).toEqual({ name: "YT Zero", color: "#0a5fff" });
    expect(from({ app_name: null, app_icon_color: null })).toEqual({ name: "YT Zero", color: "#0a5fff" });
    expect(from({})).toEqual({ name: "YT Zero", color: "#0a5fff" });
  });
});
