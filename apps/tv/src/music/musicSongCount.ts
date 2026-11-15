import "../intl";
import { localeTags } from "../i18n";
import type { Language } from "../types";

/** "12 songs", in each language's plural forms. */
export const songCountMessages: Record<Language, Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }> = {
  en: { one: "{count} song", other: "{count} songs" },
  pl: { one: "{count} utwór", few: "{count} utwory", many: "{count} utworów", other: "{count} utworu" },
  de: { one: "{count} Song", other: "{count} Songs" },
  fr: { one: "{count} titre", many: "{count} titres", other: "{count} titres" },
  es: { one: "{count} canción", many: "{count} canciones", other: "{count} canciones" },
  "pt-BR": { one: "{count} música", many: "{count} músicas", other: "{count} músicas" },
  ru: { one: "{count} трек", few: "{count} трека", many: "{count} треков", other: "{count} трека" },
  ja: { other: "{count} 曲" },
  hu: { one: "{count} dal", other: "{count} dal" },
};

const formatters = new Map<Language, { plural: Intl.PluralRules; number: Intl.NumberFormat }>();

export function formatSongCount(count: number, language: Language): string {
  let formatter = formatters.get(language);
  if (!formatter) {
    const locale = localeTags[language];
    formatter = { plural: new Intl.PluralRules(locale), number: new Intl.NumberFormat(locale) };
    formatters.set(language, formatter);
  }
  const forms = songCountMessages[language];
  return (forms[formatter.plural.select(count)] ?? forms.other).replace("{count}", formatter.number.format(count));
}
