import type { Language } from "./types";

type Messages = {
  /** The player's subtitle menu, its Off choice, and the notice when a track cannot be read. */
  subtitles: string; subtitlesOff: string; subtitlesFailed: string;
};

/** The native player's subtitles. */
export const subtitleMessages: Record<Language, Messages> = {
  en: { subtitles: "Subtitles", subtitlesOff: "Off", subtitlesFailed: "Subtitles could not be loaded" },
  pl: { subtitles: "Napisy", subtitlesOff: "Wyłączone", subtitlesFailed: "Nie udało się wczytać napisów" },
  de: { subtitles: "Untertitel", subtitlesOff: "Aus", subtitlesFailed: "Untertitel konnten nicht geladen werden" },
  fr: { subtitles: "Sous-titres", subtitlesOff: "Désactivés", subtitlesFailed: "Impossible de charger les sous-titres" },
  es: { subtitles: "Subtítulos", subtitlesOff: "Desactivados", subtitlesFailed: "No se pudieron cargar los subtítulos" },
  "pt-BR": { subtitles: "Legendas", subtitlesOff: "Desativadas", subtitlesFailed: "Não foi possível carregar as legendas" },
  ru: { subtitles: "Субтитры", subtitlesOff: "Выкл.", subtitlesFailed: "Не удалось загрузить субтитры" },
  ja: { subtitles: "字幕", subtitlesOff: "オフ", subtitlesFailed: "字幕を読み込めませんでした" },
  hu: { subtitles: "Feliratok", subtitlesOff: "Ki", subtitlesFailed: "A feliratokat nem sikerült betölteni" },
};
