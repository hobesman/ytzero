import type { Language } from "./types";

type Messages = { openSignInPage: string; pairPhoneDescription: string };

export const phoneMessages: Record<Language, Messages> = {
  en: {
    openSignInPage: "Open sign-in page",
    pairPhoneDescription: "Open the sign-in page, approve this device in YT Zero, then come back to this app.",
  },
  pl: {
    openSignInPage: "Otwórz stronę logowania",
    pairPhoneDescription: "Otwórz stronę logowania, zatwierdź to urządzenie w YT Zero i wróć do tej aplikacji.",
  },
  de: {
    openSignInPage: "Anmeldeseite öffnen",
    pairPhoneDescription: "Öffne die Anmeldeseite, bestätige dieses Gerät in YT Zero und kehre dann zu dieser App zurück.",
  },
  fr: {
    openSignInPage: "Ouvrir la page de connexion",
    pairPhoneDescription: "Ouvrez la page de connexion, approuvez cet appareil dans YT Zero, puis revenez dans cette application.",
  },
  es: {
    openSignInPage: "Abrir la página de inicio de sesión",
    pairPhoneDescription: "Abre la página de inicio de sesión, aprueba este dispositivo en YT Zero y vuelve a esta aplicación.",
  },
  "pt-BR": {
    openSignInPage: "Abrir página de login",
    pairPhoneDescription: "Abra a página de login, aprove este dispositivo no YT Zero e depois volte para este app.",
  },
  ru: {
    openSignInPage: "Открыть страницу входа",
    pairPhoneDescription: "Откройте страницу входа, подтвердите это устройство в YT Zero и вернитесь в это приложение.",
  },
  ja: {
    openSignInPage: "サインインページを開く",
    pairPhoneDescription: "サインインページを開き、YT Zero でこのデバイスを承認してから、このアプリに戻ってください。",
  },
  hu: {
    openSignInPage: "Bejelentkezési oldal megnyitása",
    pairPhoneDescription: "Nyisd meg a bejelentkezési oldalt, hagyd jóvá ezt az eszközt a YT Zeróban, majd térj vissza ebbe az alkalmazásba.",
  },
};
