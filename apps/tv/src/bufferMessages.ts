import type { Language } from "./types";

type Messages = {
  forwardBuffer: string; forwardBufferHint: string;
  bufferStandard: string; buffer30Seconds: string; buffer1Minute: string; buffer2Minutes: string;
};

/** The device's playback buffer setting. */
export const bufferMessages: Record<Language, Messages> = {
  en: {
    forwardBuffer: "Buffer ahead",
    forwardBufferHint: "Load more of the video in advance, so playback keeps going through short drops in the connection, such as moving between wifi hotspots. Uses more memory.",
    bufferStandard: "Standard", buffer30Seconds: "30 seconds", buffer1Minute: "1 minute", buffer2Minutes: "2 minutes",
  },
  pl: {
    forwardBuffer: "Buforowanie z wyprzedzeniem",
    forwardBufferHint: "Wczytuj z wyprzedzeniem większą część filmu, aby odtwarzanie trwało mimo krótkich przerw w połączeniu, np. przy przechodzeniu między punktami Wi‑Fi. Zużywa więcej pamięci.",
    bufferStandard: "Standardowe", buffer30Seconds: "30 sekund", buffer1Minute: "1 minuta", buffer2Minutes: "2 minuty",
  },
  de: {
    forwardBuffer: "Vorausladen",
    forwardBufferHint: "Mehr vom Video im Voraus laden, damit die Wiedergabe bei kurzen Verbindungsabbrüchen weiterläuft, etwa beim Wechsel zwischen WLAN-Hotspots. Braucht mehr Speicher.",
    bufferStandard: "Standard", buffer30Seconds: "30 Sekunden", buffer1Minute: "1 Minute", buffer2Minutes: "2 Minuten",
  },
  fr: {
    forwardBuffer: "Mise en mémoire tampon",
    forwardBufferHint: "Charger davantage de la vidéo à l’avance pour que la lecture continue pendant les courtes coupures de connexion, par exemple entre deux points d’accès Wi‑Fi. Utilise plus de mémoire.",
    bufferStandard: "Standard", buffer30Seconds: "30 secondes", buffer1Minute: "1 minute", buffer2Minutes: "2 minutes",
  },
  es: {
    forwardBuffer: "Búfer anticipado",
    forwardBufferHint: "Carga más parte del vídeo por adelantado para que la reproducción continúe durante cortes breves de la conexión, como al pasar de un punto wifi a otro. Usa más memoria.",
    bufferStandard: "Estándar", buffer30Seconds: "30 segundos", buffer1Minute: "1 minuto", buffer2Minutes: "2 minutos",
  },
  "pt-BR": {
    forwardBuffer: "Buffer antecipado",
    forwardBufferHint: "Carrega mais do vídeo com antecedência, para a reprodução continuar durante quedas curtas da conexão, como ao passar de um ponto de Wi‑Fi para outro. Usa mais memória.",
    bufferStandard: "Padrão", buffer30Seconds: "30 segundos", buffer1Minute: "1 minuto", buffer2Minutes: "2 minutos",
  },
  ru: {
    forwardBuffer: "Буферизация наперёд",
    forwardBufferHint: "Загружать больше видео заранее, чтобы воспроизведение не прерывалось при коротких обрывах связи, например при переходе между точками Wi‑Fi. Расходует больше памяти.",
    bufferStandard: "Стандартная", buffer30Seconds: "30 секунд", buffer1Minute: "1 минута", buffer2Minutes: "2 минуты",
  },
  ja: {
    forwardBuffer: "先読みバッファ",
    forwardBufferHint: "動画を多めに先読みして、Wi‑Fi スポット間の移動など接続が短く途切れても再生を続けます。メモリを多く使います。",
    bufferStandard: "標準", buffer30Seconds: "30 秒", buffer1Minute: "1 分", buffer2Minutes: "2 分",
  },
  hu: {
    forwardBuffer: "Előretöltés",
    forwardBufferHint: "A videó nagyobb részét előre betölti, így a lejátszás rövid kapcsolatkiesések alatt is folytatódik, például Wi‑Fi hotspotok közötti váltáskor. Több memóriát használ.",
    bufferStandard: "Normál", buffer30Seconds: "30 másodperc", buffer1Minute: "1 perc", buffer2Minutes: "2 perc",
  },
};
