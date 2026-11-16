import type { Translate, TranslationKey } from "./i18n";
import type { Language } from "./types";
import { withAppName } from "./branding";

/**
 * Strings that call the device "this television", reworded as "this device"
 * for phones and tablets. Televisions keep the original wording.
 */
export const DEVICE_WORDING_KEYS = [
  "openDetailsFirstHint", "deviceSettingsDescription", "changeInstanceHint", "signOutHint", "playbackSessionExpired",
  "instanceDescription", "pairTitle", "discoveryIntro", "discoveryHint", "incognitoModeHint",
] as const satisfies readonly TranslationKey[];

type DeviceWording = Record<(typeof DEVICE_WORDING_KEYS)[number], string>;

export const deviceWording: Record<Language, DeviceWording> = {
  en: {
    openDetailsFirstHint: "Applies to this device. By default, selecting a video starts playback immediately.",
    deviceSettingsDescription: "Connection and session settings for this device.",
    changeInstanceHint: "Forget this address and connect this device to another {app} instance.",
    signOutHint: "Remove this device's access to the current profile.",
    playbackSessionExpired: "Playback access has expired. Try again, or pair this device again in Settings.",
    instanceDescription: "Enter the address of your {app} instance. This is saved only on this device.",
    pairTitle: "Pair this device",
    discoveryIntro: "Choose a nearby {app} instance or enter its address. Then pair this device with your profile.",
    discoveryHint: "Connect this device and your server to the same local network. You can also enter an address.",
    incognitoModeHint: "Do not save watch history, progress, viewing insights, or music listens on this device.",
  },
  pl: {
    openDetailsFirstHint: "Dotyczy tego urządzenia. Domyślnie wybranie filmu od razu rozpoczyna odtwarzanie.",
    deviceSettingsDescription: "Ustawienia połączenia i sesji dla tego urządzenia.",
    changeInstanceHint: "Zapomnij ten adres i połącz to urządzenie z inną instancją {app}.",
    signOutHint: "Usuń dostęp tego urządzenia do bieżącego profilu.",
    playbackSessionExpired: "Dostęp do odtwarzania wygasł. Spróbuj ponownie lub ponownie sparuj to urządzenie w Ustawieniach.",
    instanceDescription: "Wpisz adres swojej instancji {app}. Zostanie zapisany tylko na tym urządzeniu.",
    pairTitle: "Sparuj to urządzenie",
    discoveryIntro: "Wybierz pobliską instancję {app} lub wpisz jej adres. Następnie sparuj to urządzenie ze swoim profilem.",
    discoveryHint: "Połącz to urządzenie i serwer z tą samą siecią lokalną. Możesz też wpisać adres.",
    incognitoModeHint: "Nie zapisuj historii oglądania, postępu, statystyk oglądania ani słuchanej muzyki na tym urządzeniu.",
  },
  de: {
    openDetailsFirstHint: "Gilt für dieses Gerät. Standardmäßig startet die Auswahl eines Videos sofort die Wiedergabe.",
    deviceSettingsDescription: "Verbindungs- und Sitzungseinstellungen für dieses Gerät.",
    changeInstanceHint: "Diese Adresse vergessen und dieses Gerät mit einer anderen {app}-Instanz verbinden.",
    signOutHint: "Den Zugriff dieses Geräts auf das aktuelle Profil entfernen.",
    playbackSessionExpired: "Der Wiedergabezugriff ist abgelaufen. Versuche es erneut oder kopple dieses Gerät in den Einstellungen neu.",
    instanceDescription: "Gib die Adresse deiner {app}-Instanz ein. Sie wird nur auf diesem Gerät gespeichert.",
    pairTitle: "Dieses Gerät koppeln",
    discoveryIntro: "Wähle eine {app}-Instanz in der Nähe oder gib ihre Adresse ein. Kopple dann dieses Gerät mit deinem Profil.",
    discoveryHint: "Verbinde dieses Gerät und deinen Server mit demselben lokalen Netzwerk. Du kannst auch eine Adresse eingeben.",
    incognitoModeHint: "Wiedergabeverlauf, Fortschritt, Nutzungsstatistiken und gehörte Musik auf diesem Gerät nicht speichern.",
  },
  fr: {
    openDetailsFirstHint: "S’applique à cet appareil. Par défaut, sélectionner une vidéo lance immédiatement la lecture.",
    deviceSettingsDescription: "Paramètres de connexion et de session de cet appareil.",
    changeInstanceHint: "Oublier cette adresse et connecter cet appareil à une autre instance {app}.",
    signOutHint: "Retirer l’accès de cet appareil au profil actuel.",
    playbackSessionExpired: "L’accès à la lecture a expiré. Réessayez ou associez à nouveau cet appareil dans les Paramètres.",
    instanceDescription: "Saisissez l’adresse de votre instance {app}. Elle est enregistrée uniquement sur cet appareil.",
    pairTitle: "Associer cet appareil",
    discoveryIntro: "Choisissez une instance {app} à proximité ou saisissez son adresse. Associez ensuite cet appareil à votre profil.",
    discoveryHint: "Connectez cet appareil et votre serveur au même réseau local. Vous pouvez aussi saisir une adresse.",
    incognitoModeHint: "Ne pas enregistrer l’historique, la progression, les statistiques de visionnage ni la musique écoutée sur cet appareil.",
  },
  es: {
    openDetailsFirstHint: "Se aplica a este dispositivo. De forma predeterminada, al seleccionar un vídeo se inicia la reproducción.",
    deviceSettingsDescription: "Ajustes de conexión y sesión de este dispositivo.",
    changeInstanceHint: "Olvidar esta dirección y conectar este dispositivo a otra instancia de {app}.",
    signOutHint: "Quitar el acceso de este dispositivo al perfil actual.",
    playbackSessionExpired: "El acceso a la reproducción ha caducado. Inténtalo de nuevo o vuelve a vincular este dispositivo en Ajustes.",
    instanceDescription: "Introduce la dirección de tu instancia de {app}. Solo se guarda en este dispositivo.",
    pairTitle: "Vincular este dispositivo",
    discoveryIntro: "Elige una instancia de {app} cercana o introduce su dirección. Después vincula este dispositivo con tu perfil.",
    discoveryHint: "Conecta este dispositivo y tu servidor a la misma red local. También puedes introducir una dirección.",
    incognitoModeHint: "No guardar el historial, el progreso, las estadísticas de visualización ni la música escuchada en este dispositivo.",
  },
  "pt-BR": {
    openDetailsFirstHint: "Vale para este dispositivo. Por padrão, selecionar um vídeo inicia a reprodução imediatamente.",
    deviceSettingsDescription: "Configurações de conexão e sessão deste dispositivo.",
    changeInstanceHint: "Esquecer este endereço e conectar este dispositivo a outra instância do {app}.",
    signOutHint: "Remover o acesso deste dispositivo ao perfil atual.",
    playbackSessionExpired: "O acesso à reprodução expirou. Tente novamente ou conecte este dispositivo de novo nas Configurações.",
    instanceDescription: "Digite o endereço da sua instância do {app}. Ele será salvo apenas neste dispositivo.",
    pairTitle: "Conectar este dispositivo",
    discoveryIntro: "Escolha uma instância do {app} próxima ou digite o endereço. Depois conecte este dispositivo ao seu perfil.",
    discoveryHint: "Conecte este dispositivo e o servidor à mesma rede local. Você também pode digitar um endereço.",
    incognitoModeHint: "Não salvar o histórico, o progresso, as estatísticas de visualização nem as músicas ouvidas neste dispositivo.",
  },
  ru: {
    openDetailsFirstHint: "Действует на этом устройстве. По умолчанию выбор видео сразу запускает воспроизведение.",
    deviceSettingsDescription: "Настройки подключения и сеанса для этого устройства.",
    changeInstanceHint: "Забыть этот адрес и подключить это устройство к другому экземпляру {app}.",
    signOutHint: "Отозвать доступ этого устройства к текущему профилю.",
    playbackSessionExpired: "Срок доступа к воспроизведению истёк. Повторите попытку или снова привяжите это устройство в настройках.",
    instanceDescription: "Введите адрес вашего экземпляра {app}. Он сохраняется только на этом устройстве.",
    pairTitle: "Привязать это устройство",
    discoveryIntro: "Выберите ближайший экземпляр {app} или введите его адрес. Затем привяжите это устройство к своему профилю.",
    discoveryHint: "Подключите это устройство и сервер к одной локальной сети. Также можно ввести адрес.",
    incognitoModeHint: "Не сохранять историю просмотра, прогресс, статистику просмотра и прослушанную музыку на этом устройстве.",
  },
  ja: {
    openDetailsFirstHint: "このデバイスに適用されます。既定では、動画を選ぶとすぐに再生が始まります。",
    deviceSettingsDescription: "このデバイスの接続とセッションの設定です。",
    changeInstanceHint: "このアドレスを削除して、このデバイスを別の {app} インスタンスに接続します。",
    signOutHint: "このデバイスから現在のプロフィールへのアクセスを削除します。",
    playbackSessionExpired: "再生アクセスの有効期限が切れました。もう一度試すか、設定でこのデバイスを再度ペアリングしてください。",
    instanceDescription: "{app} インスタンスのアドレスを入力してください。このデバイスにのみ保存されます。",
    pairTitle: "このデバイスをペアリング",
    discoveryIntro: "近くの {app} インスタンスを選ぶか、アドレスを入力してください。その後、このデバイスをプロフィールとペアリングします。",
    discoveryHint: "このデバイスとサーバーを同じローカルネットワークに接続してください。アドレスを入力することもできます。",
    incognitoModeHint: "このデバイスで視聴履歴、再生位置、視聴インサイト、音楽の再生記録を保存しません。",
  },
  hu: {
    openDetailsFirstHint: "Erre az eszközre vonatkozik. Alapértelmezés szerint egy videó kiválasztása azonnal elindítja a lejátszást.",
    deviceSettingsDescription: "Az eszköz kapcsolati és munkamenet-beállításai.",
    changeInstanceHint: "A cím elfelejtése, és az eszköz csatlakoztatása egy másik {app} példányhoz.",
    signOutHint: "Az eszköz hozzáférésének eltávolítása a jelenlegi profilhoz.",
    playbackSessionExpired: "A lejátszási hozzáférés lejárt. Próbáld újra, vagy párosítsd újra az eszközt a Beállításokban.",
    instanceDescription: "Add meg a(z) {app} példányod címét. Csak ezen az eszközön lesz mentve.",
    pairTitle: "Az eszköz párosítása",
    discoveryIntro: "Válassz egy közeli {app} példányt, vagy add meg a címét. Ezután párosítsd az eszközt a profiloddal.",
    discoveryHint: "Csatlakoztasd az eszközt és a szervert ugyanahhoz a helyi hálózathoz. Címet is megadhatsz.",
    incognitoModeHint: "Ne mentse a megtekintési előzményeket, a haladást, a megtekintési statisztikákat és a meghallgatott zenéket ezen az eszközön.",
  },
};

/** Uses the device wording on phones and tablets; a television keeps `t` unchanged. */
export function withDeviceWording(t: Translate, language: Language, isTV: boolean): Translate {
  if (isTV) return t;
  const wording: Partial<Record<TranslationKey, string>> = deviceWording[language];
  return (key) => { const text = wording[key]; return text === undefined ? t(key) : withAppName(text); };
}
