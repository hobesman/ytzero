import type { Language } from "./types";

type Messages = {
  defaultSpeed: string; defaultSpeedHint: string;
  rememberSpeed: string; rememberSpeedHint: string;
  sponsorSkip: string; sponsorSkipHint: string;
  musicLevelling: string; musicLevellingHint: string;
  /** Keeps `{seconds}`. */
  sponsorSkipped: string;
};

/** Playback settings that belong to the profile on the server, so every device shares them. */
export const profilePlaybackMessages: Record<Language, Messages> = {
  en: {
    defaultSpeed: "Default speed", defaultSpeedHint: "Saved to your profile, so every device uses it. A channel's own speed still comes first.",
    rememberSpeed: "Remember speed changes", rememberSpeedHint: "A speed you choose while watching becomes the default for later videos, or that channel's speed when it has its own.",
    sponsorSkip: "Skip sponsored segments", sponsorSkipHint: "SponsorBlock, with the categories chosen in your profile's settings on the web.",
    musicLevelling: "Even out song volume", musicLevellingHint: "Turns loud songs down to match quieter ones, as YouTube does.",
    sponsorSkipped: "SponsorBlock: skipped {seconds} s",
  },
  pl: {
    defaultSpeed: "Domyślna prędkość", defaultSpeedHint: "Zapisywana w profilu, więc używa jej każde urządzenie. Własna prędkość kanału ma pierwszeństwo.",
    rememberSpeed: "Zapamiętuj zmiany prędkości", rememberSpeedHint: "Prędkość wybrana podczas oglądania staje się domyślna dla kolejnych filmów albo prędkością kanału, jeśli ma on własną.",
    sponsorSkip: "Pomijaj segmenty sponsorowane", sponsorSkipHint: "SponsorBlock z kategoriami wybranymi w ustawieniach profilu w przeglądarce.",
    musicLevelling: "Wyrównuj głośność utworów", musicLevellingHint: "Ścisza głośne utwory do poziomu cichszych, tak jak YouTube.",
    sponsorSkipped: "SponsorBlock: pominięto {seconds} s",
  },
  de: {
    defaultSpeed: "Standardgeschwindigkeit", defaultSpeedHint: "Wird im Profil gespeichert und gilt so auf jedem Gerät. Die eigene Geschwindigkeit eines Kanals hat Vorrang.",
    rememberSpeed: "Geschwindigkeitsänderungen merken", rememberSpeedHint: "Eine beim Ansehen gewählte Geschwindigkeit wird zum Standard für spätere Videos oder zur Geschwindigkeit des Kanals, wenn er eine eigene hat.",
    sponsorSkip: "Gesponserte Abschnitte überspringen", sponsorSkipHint: "SponsorBlock mit den Kategorien aus den Profileinstellungen im Web.",
    musicLevelling: "Lautstärke der Songs angleichen", musicLevellingHint: "Macht laute Songs leiser, damit sie zu leiseren passen – wie bei YouTube.",
    sponsorSkipped: "SponsorBlock: {seconds} s übersprungen",
  },
  fr: {
    defaultSpeed: "Vitesse par défaut", defaultSpeedHint: "Enregistrée dans votre profil, elle s’applique sur chaque appareil. La vitesse propre à une chaîne reste prioritaire.",
    rememberSpeed: "Mémoriser les changements de vitesse", rememberSpeedHint: "La vitesse choisie pendant la lecture devient la vitesse par défaut des vidéos suivantes, ou celle de la chaîne si elle en a une.",
    sponsorSkip: "Passer les segments sponsorisés", sponsorSkipHint: "SponsorBlock, avec les catégories choisies dans les réglages du profil sur le web.",
    musicLevelling: "Égaliser le volume des titres", musicLevellingHint: "Baisse les titres forts au niveau des plus doux, comme le fait YouTube.",
    sponsorSkipped: "SponsorBlock : {seconds} s passées",
  },
  es: {
    defaultSpeed: "Velocidad predeterminada", defaultSpeedHint: "Se guarda en tu perfil, así que la usan todos los dispositivos. La velocidad propia de un canal tiene prioridad.",
    rememberSpeed: "Recordar los cambios de velocidad", rememberSpeedHint: "La velocidad que elijas al ver un vídeo pasa a ser la predeterminada para los siguientes, o la del canal si tiene una propia.",
    sponsorSkip: "Saltar segmentos patrocinados", sponsorSkipHint: "SponsorBlock, con las categorías elegidas en los ajustes del perfil en la web.",
    musicLevelling: "Igualar el volumen de las canciones", musicLevellingHint: "Baja las canciones fuertes al nivel de las más suaves, como hace YouTube.",
    sponsorSkipped: "SponsorBlock: {seconds} s saltados",
  },
  "pt-BR": {
    defaultSpeed: "Velocidade padrão", defaultSpeedHint: "Fica salva no seu perfil, então todos os dispositivos a usam. A velocidade própria de um canal tem prioridade.",
    rememberSpeed: "Lembrar mudanças de velocidade", rememberSpeedHint: "A velocidade escolhida durante a reprodução se torna o padrão dos próximos vídeos, ou a velocidade do canal quando ele tem uma própria.",
    sponsorSkip: "Pular trechos patrocinados", sponsorSkipHint: "SponsorBlock, com as categorias escolhidas nas configurações do perfil na web.",
    musicLevelling: "Equalizar o volume das músicas", musicLevellingHint: "Abaixa as músicas mais altas para combinar com as mais baixas, como o YouTube faz.",
    sponsorSkipped: "SponsorBlock: {seconds} s pulados",
  },
  ru: {
    defaultSpeed: "Скорость по умолчанию", defaultSpeedHint: "Сохраняется в профиле, поэтому действует на всех устройствах. Собственная скорость канала важнее.",
    rememberSpeed: "Запоминать изменения скорости", rememberSpeedHint: "Скорость, выбранная во время просмотра, становится скоростью по умолчанию для следующих видео или скоростью канала, если у него есть своя.",
    sponsorSkip: "Пропускать спонсорские фрагменты", sponsorSkipHint: "SponsorBlock с категориями из настроек профиля в веб-версии.",
    musicLevelling: "Выравнивать громкость песен", musicLevellingHint: "Делает громкие песни тише, чтобы они звучали наравне с тихими, как на YouTube.",
    sponsorSkipped: "SponsorBlock: пропущено {seconds} с",
  },
  ja: {
    defaultSpeed: "既定の速度", defaultSpeedHint: "プロフィールに保存され、すべてのデバイスで使われます。チャンネル独自の速度が優先されます。",
    rememberSpeed: "速度の変更を記憶", rememberSpeedHint: "再生中に選んだ速度を、以降の動画の既定の速度にします。チャンネルに独自の速度がある場合は、そのチャンネルの速度になります。",
    sponsorSkip: "スポンサー区間をスキップ", sponsorSkipHint: "SponsorBlock を使い、ウェブのプロフィール設定で選んだカテゴリをスキップします。",
    musicLevelling: "曲の音量をそろえる", musicLevellingHint: "YouTube と同じように、音の大きい曲を静かな曲に合わせて下げます。",
    sponsorSkipped: "SponsorBlock: {seconds} 秒スキップしました",
  },
  hu: {
    defaultSpeed: "Alapértelmezett sebesség", defaultSpeedHint: "A profilba mentődik, így minden eszköz ezt használja. A csatorna saját sebessége elsőbbséget élvez.",
    rememberSpeed: "Sebességváltozások megjegyzése", rememberSpeedHint: "A lejátszás közben választott sebesség lesz az alapértelmezett a későbbi videóknál, vagy a csatorna sebessége, ha annak saját van.",
    sponsorSkip: "Szponzorált részek átugrása", sponsorSkipHint: "SponsorBlock, a profil webes beállításaiban kiválasztott kategóriákkal.",
    musicLevelling: "Dalok hangerejének kiegyenlítése", musicLevellingHint: "A hangos dalokat a halkabbakhoz igazítja, ahogy a YouTube is.",
    sponsorSkipped: "SponsorBlock: {seconds} mp átugorva",
  },
};
