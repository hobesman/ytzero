import type { Language } from "./types";

type Messages = {
  /** Video actions: the youtube.com link, or a public link through the user's own server. */
  shareYouTubeLink: string; shareYtZeroLink: string; shareYtZeroLinkHint: string;
  /** Music mode's song menu: shares the music.youtube.com link. */
  shareSong: string;
  shareFailed: string; shareUnavailable: string;
};

/** Sharing songs and videos from the phone app through Android's share sheet. */
export const shareMessages: Record<Language, Messages> = {
  en: {
    shareYouTubeLink: "Share YouTube link", shareYtZeroLink: "Share {app} link", shareYtZeroLinkHint: "Watch it through your {app} server, within its sharing limits.",
    shareSong: "Share", shareFailed: "Couldn't create a {app} link. Try again.", shareUnavailable: "This video can't be shared from {app}.",
  },
  pl: {
    shareYouTubeLink: "Udostępnij link do YouTube", shareYtZeroLink: "Udostępnij link do {app}", shareYtZeroLinkHint: "Oglądanie przez Twój serwer {app}, w ramach jego limitów udostępniania.",
    shareSong: "Udostępnij", shareFailed: "Nie udało się utworzyć linku do {app}. Spróbuj ponownie.", shareUnavailable: "Tego filmu nie można udostępnić z {app}.",
  },
  de: {
    shareYouTubeLink: "YouTube-Link teilen", shareYtZeroLink: "{app}-Link teilen", shareYtZeroLinkHint: "Über deinen {app}-Server ansehen, innerhalb seiner Freigabegrenzen.",
    shareSong: "Teilen", shareFailed: "Der {app}-Link konnte nicht erstellt werden. Versuche es erneut.", shareUnavailable: "Dieses Video kann nicht über {app} geteilt werden.",
  },
  fr: {
    shareYouTubeLink: "Partager le lien YouTube", shareYtZeroLink: "Partager le lien {app}", shareYtZeroLinkHint: "À regarder via votre serveur {app}, dans ses limites de partage.",
    shareSong: "Partager", shareFailed: "Impossible de créer le lien {app}. Réessayez.", shareUnavailable: "Cette vidéo ne peut pas être partagée depuis {app}.",
  },
  es: {
    shareYouTubeLink: "Compartir enlace de YouTube", shareYtZeroLink: "Compartir enlace de {app}", shareYtZeroLinkHint: "Para verlo a través de tu servidor {app}, dentro de sus límites para compartir.",
    shareSong: "Compartir", shareFailed: "No se pudo crear el enlace de {app}. Inténtalo de nuevo.", shareUnavailable: "Este vídeo no se puede compartir desde {app}.",
  },
  "pt-BR": {
    shareYouTubeLink: "Compartilhar link do YouTube", shareYtZeroLink: "Compartilhar link do {app}", shareYtZeroLinkHint: "Para assistir pelo seu servidor {app}, dentro dos limites de compartilhamento dele.",
    shareSong: "Compartilhar", shareFailed: "Não foi possível criar o link do {app}. Tente de novo.", shareUnavailable: "Este vídeo não pode ser compartilhado pelo {app}.",
  },
  ru: {
    shareYouTubeLink: "Поделиться ссылкой YouTube", shareYtZeroLink: "Поделиться ссылкой {app}", shareYtZeroLinkHint: "Просмотр через ваш сервер {app}, в пределах его ограничений на общий доступ.",
    shareSong: "Поделиться", shareFailed: "Не удалось создать ссылку {app}. Повторите попытку.", shareUnavailable: "Этим видео нельзя поделиться через {app}.",
  },
  ja: {
    shareYouTubeLink: "YouTube のリンクを共有", shareYtZeroLink: "{app} のリンクを共有", shareYtZeroLinkHint: "あなたの {app} サーバー経由で、共有の制限内で視聴できます。",
    shareSong: "共有", shareFailed: "{app} のリンクを作成できませんでした。もう一度お試しください。", shareUnavailable: "この動画は {app} から共有できません。",
  },
  hu: {
    shareYouTubeLink: "YouTube-link megosztása", shareYtZeroLink: "{app}-link megosztása", shareYtZeroLinkHint: "Megtekintés a(z) {app}-szervereden keresztül, annak megosztási korlátain belül.",
    shareSong: "Megosztás", shareFailed: "Nem sikerült létrehozni a(z) {app}-linket. Próbáld újra.", shareUnavailable: "Ez a videó nem osztható meg a YT Zeróból.",
  },
};
