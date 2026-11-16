import { expect, test } from "bun:test";
import { localeTags } from "../i18n";
import type { Language } from "../types";
import { formatSongCount, songCountMessages } from "./musicSongCount";

test("song counts follow each language's plural forms", () => {
  for (const [count, expected] of [[1, "1 utwór"], [2, "2 utwory"], [5, "5 utworów"], [22, "22 utwory"]] as const) expect(formatSongCount(count, "pl")).toBe(expected);
  for (const [count, expected] of [[1, "1 трек"], [3, "3 трека"], [11, "11 треков"]] as const) expect(formatSongCount(count, "ru")).toBe(expected);
  expect(formatSongCount(1, "en")).toBe("1 song");
  expect(formatSongCount(0, "en")).toBe("0 songs");
  expect(formatSongCount(4, "ja")).toBe("4 曲");
});

test("every supported locale has every plural category with a count placeholder", () => {
  for (const language of Object.keys(localeTags) as Language[]) {
    for (const category of new Intl.PluralRules(localeTags[language]).resolvedOptions().pluralCategories) {
      expect(songCountMessages[language][category]).toContain("{count}");
    }
  }
});
