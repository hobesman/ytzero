import type { Language } from "./types";

type Messages = {
  /** The player button and its list. "{count}" is whole minutes. */
  sleepTimer: string; sleepTimerOff: string; sleepTimerMinutes: string; sleepTimerEndOfVideo: string;
  /** Shown over the player when the timer has paused it. */
  sleepTimerStopped: string;
};

/** The player's sleep timer. */
export const sleepTimerMessages: Record<Language, Messages> = {
  en: { sleepTimer: "Sleep timer", sleepTimerOff: "Off", sleepTimerMinutes: "{count} minutes", sleepTimerEndOfVideo: "End of video", sleepTimerStopped: "Sleep timer paused the video" },
  pl: { sleepTimer: "Wyłącznik czasowy", sleepTimerOff: "Wyłączony", sleepTimerMinutes: "{count} minut", sleepTimerEndOfVideo: "Koniec filmu", sleepTimerStopped: "Wyłącznik czasowy wstrzymał film" },
  de: { sleepTimer: "Sleep-Timer", sleepTimerOff: "Aus", sleepTimerMinutes: "{count} Minuten", sleepTimerEndOfVideo: "Ende des Videos", sleepTimerStopped: "Der Sleep-Timer hat das Video angehalten" },
  fr: { sleepTimer: "Minuteur de veille", sleepTimerOff: "Désactivé", sleepTimerMinutes: "{count} minutes", sleepTimerEndOfVideo: "Fin de la vidéo", sleepTimerStopped: "Le minuteur de veille a mis la vidéo en pause" },
  es: { sleepTimer: "Temporizador de apagado", sleepTimerOff: "Desactivado", sleepTimerMinutes: "{count} minutos", sleepTimerEndOfVideo: "Final del vídeo", sleepTimerStopped: "El temporizador ha pausado el vídeo" },
  "pt-BR": { sleepTimer: "Timer de desligamento", sleepTimerOff: "Desativado", sleepTimerMinutes: "{count} minutos", sleepTimerEndOfVideo: "Fim do vídeo", sleepTimerStopped: "O timer pausou o vídeo" },
  ru: { sleepTimer: "Таймер сна", sleepTimerOff: "Выкл.", sleepTimerMinutes: "{count} минут", sleepTimerEndOfVideo: "Конец видео", sleepTimerStopped: "Таймер сна приостановил видео" },
  ja: { sleepTimer: "スリープタイマー", sleepTimerOff: "オフ", sleepTimerMinutes: "{count} 分", sleepTimerEndOfVideo: "動画の終わり", sleepTimerStopped: "スリープタイマーで動画を一時停止しました" },
  hu: { sleepTimer: "Elalváskapcsoló", sleepTimerOff: "Ki", sleepTimerMinutes: "{count} perc", sleepTimerEndOfVideo: "A videó végén", sleepTimerStopped: "Az elalváskapcsoló szüneteltette a videót" },
};
