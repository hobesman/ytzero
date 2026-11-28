import { describe, expect, test } from "bun:test";
import { buildSubtitleAvailability, normalizeSubtitleLanguage, parseMetadata } from "./subtitleAvailability";

const vtt = (name: string, url = "https://www.youtube.com/api/timedtext?lang=en") => [{ name, ext: "vtt", url }];

describe("subtitle availability", () => {
  test("reads yt-dlp's NA, for a video with no author tracks, as none", () => {
    const automatic = { en: vtt("English") };
    expect(parseMetadata(`NA\n${JSON.stringify(automatic)}\n`)).toEqual({ subtitles: {}, automaticCaptions: automatic });
    expect(parseMetadata("NA\nNA\n")).toEqual({ subtitles: {}, automaticCaptions: {} });
    expect(() => parseMetadata("NA\n")).toThrow("incomplete");
  });

  test("folds only YouTube's opaque per-track suffix", () => {
    expect(normalizeSubtitleLanguage("en-nP7-2PuUl7o")).toBe("en");
    expect(normalizeSubtitleLanguage("fr-gqnk0mWVyHo")).toBe("fr");
    expect(normalizeSubtitleLanguage("pt-BR")).toBe("pt-BR");
    expect(normalizeSubtitleLanguage("zh-Hans")).toBe("zh-Hans");
    expect(normalizeSubtitleLanguage("zh-Hant")).toBe("zh-Hant");
  });

  test("keeps author tracks, filters automatic captions, and retains fallbacks", () => {
    const available = buildSubtitleAvailability(
      {
        en: vtt("English"),
        "en-nP7-2PuUl7o": vtt("English (audio description)"),
        "pt-BR": vtt("Português (Brasil)"),
      },
      {
        fr: vtt("French (auto-generated)"),
        de: vtt("German (auto-generated)"),
      },
      ["fr"],
    );

    expect(available).toEqual(expect.arrayContaining([
      { lang: "en", label: "English", tracks: ["en", "en-nP7-2PuUl7o"] },
      { lang: "pt-BR", label: "Português (Brasil)", tracks: ["pt-BR"] },
      { lang: "fr", label: "Français", tracks: ["fr"] },
    ]));
    expect(available.some((subtitle) => subtitle.lang === "de")).toBe(false);
  });

  test("uses an author track before an automatic track in the same language", () => {
    const available = buildSubtitleAvailability(
      { fr: vtt("French") },
      { "fr-gqnk0mWVyHo": vtt("French (auto-generated)") },
      ["fr"],
    );
    expect(available.find((subtitle) => subtitle.lang === "fr")?.tracks).toEqual(["fr", "fr-gqnk0mWVyHo"]);
  });

  test("offers only direct WebVTT and excludes HLS manifests", () => {
    const available = buildSubtitleAvailability(
      {
        en: [{ name: "English", ext: "json3", url: "https://www.youtube.com/api/timedtext?fmt=json3" }],
        fr: [{ name: "French", ext: "vtt", url: "https://www.youtube.com/api/manifest/hls_variant/abc" }],
        pl: vtt("Polski", "https://www.youtube.com/api/timedtext?lang=pl"),
      },
      {},
      [],
    );
    expect(available).toEqual([{ lang: "pl", label: "Polski", tracks: ["pl"] }]);
  });

  test("puts the captions of what was said ahead of YouTube's translation into the language", () => {
    const available = buildSubtitleAvailability({}, {
      en: vtt("English", "https://www.youtube.com/api/timedtext?lang=en&tlang=en"),
      "en-orig": vtt("English (Original)", "https://www.youtube.com/api/timedtext?lang=en"),
      fr: vtt("French", "https://www.youtube.com/api/timedtext?lang=en&tlang=fr"),
    }, ["en", "fr"]);
    expect(available.find((subtitle) => subtitle.lang === "en")?.tracks).toEqual(["en-orig", "en"]);
    expect(available.find((subtitle) => subtitle.lang === "fr")?.tracks).toEqual(["fr"]);
    expect(available.some((subtitle) => subtitle.lang === "en-orig")).toBe(false);
  });
});
