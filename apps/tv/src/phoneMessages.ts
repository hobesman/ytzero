import type { Language } from "./types";

type Messages = {
  openSignInPage: string; pairPhoneDescription: string; playbackSpeed: string;
  miniPlayerExpand: string; miniPlayerClose: string; miniPlayerPlay: string; miniPlayerPause: string;
};

export const phoneMessages: Record<Language, Messages> = {
  en: {
    openSignInPage: "Open sign-in page",
    playbackSpeed: "Playback speed",
    miniPlayerExpand: "Expand player",
    miniPlayerClose: "Close player",
    miniPlayerPlay: "Play",
    miniPlayerPause: "Pause",
    pairPhoneDescription: "Open the sign-in page, approve this device in YT Zero, then come back to this app.",
  },
  pl: {
    openSignInPage: "Otwórz stronę logowania",
    playbackSpeed: "Prędkość odtwarzania",
    miniPlayerExpand: "Rozwiń odtwarzacz",
    miniPlayerClose: "Zamknij odtwarzacz",
    miniPlayerPlay: "Odtwórz",
    miniPlayerPause: "Wstrzymaj",
    pairPhoneDescription: "Otwórz stronę logowania, zatwierdź to urządzenie w YT Zero i wróć do tej aplikacji.",
  },
  de: {
    openSignInPage: "Anmeldeseite öffnen",
    playbackSpeed: "Wiedergabegeschwindigkeit",
    miniPlayerExpand: "Player vergrößern",
    miniPlayerClose: "Player schließen",
    miniPlayerPlay: "Abspielen",
    miniPlayerPause: "Pausieren",
    pairPhoneDescription: "Öffne die Anmeldeseite, bestätige dieses Gerät in YT Zero und kehre dann zu dieser App zurück.",
  },
  fr: {
    openSignInPage: "Ouvrir la page de connexion",
    playbackSpeed: "Vitesse de lecture",
    miniPlayerExpand: "Agrandir le lecteur",
    miniPlayerClose: "Fermer le lecteur",
    miniPlayerPlay: "Lire",
    miniPlayerPause: "Pause",
    pairPhoneDescription: "Ouvrez la page de connexion, approuvez cet appareil dans YT Zero, puis revenez dans cette application.",
  },
  es: {
    openSignInPage: "Abrir la página de inicio de sesión",
    playbackSpeed: "Velocidad de reproducción",
    miniPlayerExpand: "Ampliar reproductor",
    miniPlayerClose: "Cerrar reproductor",
    miniPlayerPlay: "Reproducir",
    miniPlayerPause: "Pausar",
    pairPhoneDescription: "Abre la página de inicio de sesión, aprueba este dispositivo en YT Zero y vuelve a esta aplicación.",
  },
  "pt-BR": {
    openSignInPage: "Abrir página de login",
    playbackSpeed: "Velocidade de reprodução",
    miniPlayerExpand: "Expandir player",
    miniPlayerClose: "Fechar player",
    miniPlayerPlay: "Reproduzir",
    miniPlayerPause: "Pausar",
    pairPhoneDescription: "Abra a página de login, aprove este dispositivo no YT Zero e depois volte para este app.",
  },
  ru: {
    openSignInPage: "Открыть страницу входа",
    playbackSpeed: "Скорость воспроизведения",
    miniPlayerExpand: "Развернуть плеер",
    miniPlayerClose: "Закрыть плеер",
    miniPlayerPlay: "Воспроизвести",
    miniPlayerPause: "Пауза",
    pairPhoneDescription: "Откройте страницу входа, подтвердите это устройство в YT Zero и вернитесь в это приложение.",
  },
  ja: {
    openSignInPage: "サインインページを開く",
    playbackSpeed: "再生速度",
    miniPlayerExpand: "プレーヤーを拡大",
    miniPlayerClose: "プレーヤーを閉じる",
    miniPlayerPlay: "再生",
    miniPlayerPause: "一時停止",
    pairPhoneDescription: "サインインページを開き、YT Zero でこのデバイスを承認してから、このアプリに戻ってください。",
  },
  hu: {
    openSignInPage: "Bejelentkezési oldal megnyitása",
    playbackSpeed: "Lejátszási sebesség",
    miniPlayerExpand: "Lejátszó kinagyítása",
    miniPlayerClose: "Lejátszó bezárása",
    miniPlayerPlay: "Lejátszás",
    miniPlayerPause: "Szünet",
    pairPhoneDescription: "Nyisd meg a bejelentkezési oldalt, hagyd jóvá ezt az eszközt a YT Zeróban, majd térj vissza ebbe az alkalmazásba.",
  },
};
