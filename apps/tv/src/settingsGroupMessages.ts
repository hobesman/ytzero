import type { Language } from "./types";

type Messages = {
  /** The phone settings screen's groups: both modes, music mode, video mode, and the app and its connection. */
  settingsGroupGeneral: string; settingsGroupMusic: string; settingsGroupVideo: string; settingsGroupSystem: string;
};

/** Headings that group the phone settings screen. */
export const settingsGroupMessages: Record<Language, Messages> = {
  en: { settingsGroupGeneral: "General", settingsGroupMusic: "Music", settingsGroupVideo: "Video", settingsGroupSystem: "System" },
  pl: { settingsGroupGeneral: "Ogólne", settingsGroupMusic: "Muzyka", settingsGroupVideo: "Wideo", settingsGroupSystem: "System" },
  de: { settingsGroupGeneral: "Allgemein", settingsGroupMusic: "Musik", settingsGroupVideo: "Video", settingsGroupSystem: "System" },
  fr: { settingsGroupGeneral: "Général", settingsGroupMusic: "Musique", settingsGroupVideo: "Vidéo", settingsGroupSystem: "Système" },
  es: { settingsGroupGeneral: "General", settingsGroupMusic: "Música", settingsGroupVideo: "Vídeo", settingsGroupSystem: "Sistema" },
  "pt-BR": { settingsGroupGeneral: "Geral", settingsGroupMusic: "Música", settingsGroupVideo: "Vídeo", settingsGroupSystem: "Sistema" },
  ru: { settingsGroupGeneral: "Общие", settingsGroupMusic: "Музыка", settingsGroupVideo: "Видео", settingsGroupSystem: "Система" },
  ja: { settingsGroupGeneral: "一般", settingsGroupMusic: "音楽", settingsGroupVideo: "動画", settingsGroupSystem: "システム" },
  hu: { settingsGroupGeneral: "Általános", settingsGroupMusic: "Zene", settingsGroupVideo: "Videó", settingsGroupSystem: "Rendszer" },
};
