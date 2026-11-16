import { describe, expect, test } from "bun:test";
import { brandingFromServer, normalizeBranding } from "./branding";

// The shapes app/src/app-manifest.ts and app/src/app-icon.ts serve.
const favicon = (color: string, rounded = true) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect width="512" height="512"${rounded ? ' rx="112"' : ""} fill="${color}"/>
    <svg x="112" y="112" width="288" height="288" viewBox="0 0 24 24" fill="#fff" stroke="#fff"><path d="M5 5z"/></svg>
  </svg>`;

describe("build branding", () => {
  test("reads the name and color the server publishes", () => {
    expect(brandingFromServer({ name: "Hoban Tube", short_name: "Hoban Tube" }, favicon("#C81E1E"))).toEqual({ name: "Hoban Tube", color: "#c81e1e" });
    expect(brandingFromServer({ name: "YT Zero" }, favicon("#0a5fff", false))).toEqual({ name: "YT Zero", color: "#0a5fff" });
  });

  test("gives up when the server publishes neither", () => {
    expect(brandingFromServer({}, favicon("#123456"))).toBeNull();
    expect(brandingFromServer({ name: "Hoban Tube" }, "<html></html>")).toBeNull();
    expect(brandingFromServer(null, favicon("#123456"))).toBeNull();
  });

  test("falls back to YT Zero for anything malformed", () => {
    expect(normalizeBranding({ name: "  ", color: "red" })).toEqual({ name: "YT Zero", color: "#0a5fff" });
    expect(normalizeBranding(null)).toEqual({ name: "YT Zero", color: "#0a5fff" });
  });
});
