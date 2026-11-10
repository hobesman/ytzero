import type { Language } from "./types";

type Messages = {
  forwardBuffer: string; forwardBufferHint: string;
  bufferStandard: string; buffer30Seconds: string; buffer1Minute: string; buffer2Minutes: string;
  /** The choice that opens the number entry, and a custom value in the list ("{count}" is whole seconds). */
  bufferCustom: string; bufferCustomValue: string; bufferCustomHint: string; bufferSecondsUnit: string;
  save: string;
};

/** The device's playback buffer setting. */
export const bufferMessages: Record<Language, Messages> = {
  en: {
    forwardBuffer: "Buffer ahead",
    forwardBufferHint: "Load more of the video in advance, so playback keeps going through short drops in the connection, such as moving between wifi hotspots. Uses more memory.",
    bufferStandard: "Standard", buffer30Seconds: "30 seconds", buffer1Minute: "1 minute", buffer2Minutes: "2 minutes",
    bufferCustom: "Custom…", bufferCustomValue: "{count} s", bufferCustomHint: "Between 5 and 600 seconds. At high quality a long buffer may hold less, to save memory.", bufferSecondsUnit: "seconds",
    save: "Save",
  },
  pl: {
    forwardBuffer: "Buforowanie z wyprzedzeniem",
    forwardBufferHint: "Wczytuj z wyprzedzeniem większą część filmu, aby odtwarzanie trwało mimo krótkich przerw w połączeniu, np. przy przechodzeniu między punktami Wi‑Fi. Zużywa więcej pamięci.",
    bufferStandard: "Standardowe", buffer30Seconds: "30 sekund", buffer1Minute: "1 minuta", buffer2Minutes: "2 minuty",
    bufferCustom: "Własne…", bufferCustomValue: "{count} s", bufferCustomHint: "Od 5 do 600 sekund. Przy wysokiej jakości długi bufor może mieścić mniej, aby oszczędzać pamięć.", bufferSecondsUnit: "sekund",
    save: "Zapisz",
  },
  de: {
    forwardBuffer: "Vorausladen",
    forwardBufferHint: "Mehr vom Video im Voraus laden, damit die Wiedergabe bei kurzen Verbindungsabbrüchen weiterläuft, etwa beim Wechsel zwischen WLAN-Hotspots. Braucht mehr Speicher.",
    bufferStandard: "Standard", buffer30Seconds: "30 Sekunden", buffer1Minute: "1 Minute", buffer2Minutes: "2 Minuten",
    bufferCustom: "Benutzerdefiniert…", bufferCustomValue: "{count} s", bufferCustomHint: "Zwischen 5 und 600 Sekunden. Bei hoher Qualität kann ein langer Puffer weniger fassen, um Speicher zu sparen.", bufferSecondsUnit: "Sekunden",
    save: "Speichern",
  },
  fr: {
    forwardBuffer: "Mise en mémoire tampon",
    forwardBufferHint: "Charger davantage de la vidéo à l’avance pour que la lecture continue pendant les courtes coupures de connexion, par exemple entre deux points d’accès Wi‑Fi. Utilise plus de mémoire.",
    bufferStandard: "Standard", buffer30Seconds: "30 secondes", buffer1Minute: "1 minute", buffer2Minutes: "2 minutes",
    bufferCustom: "Personnalisé…", bufferCustomValue: "{count} s", bufferCustomHint: "Entre 5 et 600 secondes. En haute qualité, une longue mémoire tampon peut contenir moins, pour économiser la mémoire.", bufferSecondsUnit: "secondes",
    save: "Enregistrer",
  },
  es: {
    forwardBuffer: "Búfer anticipado",
    forwardBufferHint: "Carga más parte del vídeo por adelantado para que la reproducción continúe durante cortes breves de la conexión, como al pasar de un punto wifi a otro. Usa más memoria.",
    bufferStandard: "Estándar", buffer30Seconds: "30 segundos", buffer1Minute: "1 minuto", buffer2Minutes: "2 minutos",
    bufferCustom: "Personalizado…", bufferCustomValue: "{count} s", bufferCustomHint: "Entre 5 y 600 segundos. En alta calidad, un búfer largo puede guardar menos para ahorrar memoria.", bufferSecondsUnit: "segundos",
    save: "Guardar",
  },
  "pt-BR": {
    forwardBuffer: "Buffer antecipado",
    forwardBufferHint: "Carrega mais do vídeo com antecedência, para a reprodução continuar durante quedas curtas da conexão, como ao passar de um ponto de Wi‑Fi para outro. Usa mais memória.",
    bufferStandard: "Padrão", buffer30Seconds: "30 segundos", buffer1Minute: "1 minuto", buffer2Minutes: "2 minutos",
    bufferCustom: "Personalizado…", bufferCustomValue: "{count} s", bufferCustomHint: "Entre 5 e 600 segundos. Em alta qualidade, um buffer longo pode guardar menos para economizar memória.", bufferSecondsUnit: "segundos",
    save: "Salvar",
  },
  ru: {
    forwardBuffer: "Буферизация наперёд",
    forwardBufferHint: "Загружать больше видео заранее, чтобы воспроизведение не прерывалось при коротких обрывах связи, например при переходе между точками Wi‑Fi. Расходует больше памяти.",
    bufferStandard: "Стандартная", buffer30Seconds: "30 секунд", buffer1Minute: "1 минута", buffer2Minutes: "2 минуты",
    bufferCustom: "Своё значение…", bufferCustomValue: "{count} с", bufferCustomHint: "От 5 до 600 секунд. При высоком качестве длинный буфер может вмещать меньше, чтобы экономить память.", bufferSecondsUnit: "с",
    save: "Сохранить",
  },
  ja: {
    forwardBuffer: "先読みバッファ",
    forwardBufferHint: "動画を多めに先読みして、Wi‑Fi スポット間の移動など接続が短く途切れても再生を続けます。メモリを多く使います。",
    bufferStandard: "標準", buffer30Seconds: "30 秒", buffer1Minute: "1 分", buffer2Minutes: "2 分",
    bufferCustom: "カスタム…", bufferCustomValue: "{count} 秒", bufferCustomHint: "5〜600 秒で指定します。高画質では、メモリ節約のため長いバッファでも保持量が少なくなることがあります。", bufferSecondsUnit: "秒",
    save: "保存",
  },
  hu: {
    forwardBuffer: "Előretöltés",
    forwardBufferHint: "A videó nagyobb részét előre betölti, így a lejátszás rövid kapcsolatkiesések alatt is folytatódik, például Wi‑Fi hotspotok közötti váltáskor. Több memóriát használ.",
    bufferStandard: "Normál", buffer30Seconds: "30 másodperc", buffer1Minute: "1 perc", buffer2Minutes: "2 perc",
    bufferCustom: "Egyéni…", bufferCustomValue: "{count} mp", bufferCustomHint: "5 és 600 másodperc között. Magas minőségnél a hosszú puffer a memória kímélése érdekében kevesebbet tárolhat.", bufferSecondsUnit: "másodperc",
    save: "Mentés",
  },
};
