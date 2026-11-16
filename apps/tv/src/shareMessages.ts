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
    shareYouTubeLink: "Share YouTube link", shareYtZeroLink: "Share YT Zero link", shareYtZeroLinkHint: "Watch it through your YT Zero server, within its sharing limits.",
    shareSong: "Share", shareFailed: "Couldn't create a YT Zero link. Try again.", shareUnavailable: "This video can't be shared from YT Zero.",
  },
  pl: {
    shareYouTubeLink: "Udostępnij link do YouTube", shareYtZeroLink: "Udostępnij link do YT Zero", shareYtZeroLinkHint: "Oglądanie przez Twój serwer YT Zero, w ramach jego limitów udostępniania.",
    shareSong: "Udostępnij", shareFailed: "Nie udało się utworzyć linku do YT Zero. Spróbuj ponownie.", shareUnavailable: "Tego filmu nie można udostępnić z YT Zero.",
  },
  de: {
    shareYouTubeLink: "YouTube-Link teilen", shareYtZeroLink: "YT-Zero-Link teilen", shareYtZeroLinkHint: "Über deinen YT-Zero-Server ansehen, innerhalb seiner Freigabegrenzen.",
    shareSong: "Teilen", shareFailed: "Der YT-Zero-Link konnte nicht erstellt werden. Versuche es erneut.", shareUnavailable: "Dieses Video kann nicht über YT Zero geteilt werden.",
  },
  fr: {
    shareYouTubeLink: "Partager le lien YouTube", shareYtZeroLink: "Partager le lien YT Zero", shareYtZeroLinkHint: "À regarder via votre serveur YT Zero, dans ses limites de partage.",
    shareSong: "Partager", shareFailed: "Impossible de créer le lien YT Zero. Réessayez.", shareUnavailable: "Cette vidéo ne peut pas être partagée depuis YT Zero.",
  },
  es: {
    shareYouTubeLink: "Compartir enlace de YouTube", shareYtZeroLink: "Compartir enlace de YT Zero", shareYtZeroLinkHint: "Para verlo a través de tu servidor YT Zero, dentro de sus límites para compartir.",
    shareSong: "Compartir", shareFailed: "No se pudo crear el enlace de YT Zero. Inténtalo de nuevo.", shareUnavailable: "Este vídeo no se puede compartir desde YT Zero.",
  },
  "pt-BR": {
    shareYouTubeLink: "Compartilhar link do YouTube", shareYtZeroLink: "Compartilhar link do YT Zero", shareYtZeroLinkHint: "Para assistir pelo seu servidor YT Zero, dentro dos limites de compartilhamento dele.",
    shareSong: "Compartilhar", shareFailed: "Não foi possível criar o link do YT Zero. Tente de novo.", shareUnavailable: "Este vídeo não pode ser compartilhado pelo YT Zero.",
  },
  ru: {
    shareYouTubeLink: "Поделиться ссылкой YouTube", shareYtZeroLink: "Поделиться ссылкой YT Zero", shareYtZeroLinkHint: "Просмотр через ваш сервер YT Zero, в пределах его ограничений на общий доступ.",
    shareSong: "Поделиться", shareFailed: "Не удалось создать ссылку YT Zero. Повторите попытку.", shareUnavailable: "Этим видео нельзя поделиться через YT Zero.",
  },
  ja: {
    shareYouTubeLink: "YouTube のリンクを共有", shareYtZeroLink: "YT Zero のリンクを共有", shareYtZeroLinkHint: "あなたの YT Zero サーバー経由で、共有の制限内で視聴できます。",
    shareSong: "共有", shareFailed: "YT Zero のリンクを作成できませんでした。もう一度お試しください。", shareUnavailable: "この動画は YT Zero から共有できません。",
  },
  hu: {
    shareYouTubeLink: "YouTube-link megosztása", shareYtZeroLink: "YT Zero-link megosztása", shareYtZeroLinkHint: "Megtekintés a YT Zero-szervereden keresztül, annak megosztási korlátain belül.",
    shareSong: "Megosztás", shareFailed: "Nem sikerült létrehozni a YT Zero-linket. Próbáld újra.", shareUnavailable: "Ez a videó nem osztható meg a YT Zeróból.",
  },
};
