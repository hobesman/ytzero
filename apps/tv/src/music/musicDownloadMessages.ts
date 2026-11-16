import type { Language } from "../types";

type Messages = {
  /** The Download action on a song's menu and on album and playlist pages, and its states. */
  musicDownload: string; musicDownloaded: string; musicDownloading: string; musicDownloadingCount: string; musicDownloadFailed: string; musicRemoveDownload: string;
  /** Library's Downloads section. */
  musicDownloads: string; musicDownloadsEmpty: string; musicDownloadSongCount: string;
  musicDeleteDownloadConfirm: string; musicDeleteAllDownloadsConfirm: string;
  musicDownloadWifiOnly: string; musicDownloadWifiOnlyHint: string;
  /** Shown while the server can't be reached and the downloads stand in for it. */
  musicOffline: string;
  /** On the "couldn't load" screen: plays the downloaded music. */
  musicPlayDownloads: string;
};

/** Music saved on the phone for offline listening. Shared download wording (Wi-Fi, storage, Delete) is in phoneDownloadMessages.ts. */
export const musicDownloadMessages: Record<Language, Messages> = {
  en: {
    musicDownload: "Download", musicDownloaded: "Downloaded", musicDownloading: "Downloading…", musicDownloadingCount: "Downloading · {done} of {count}",
    musicDownloadFailed: "Download failed · tap to retry", musicRemoveDownload: "Remove download",
    musicDownloads: "Downloads", musicDownloadsEmpty: "Download songs, albums and playlists to play them without a connection", musicDownloadSongCount: "{count} songs",
    musicDeleteDownloadConfirm: "Remove “{title}” from this phone?", musicDeleteAllDownloadsConfirm: "Remove all downloaded music from this phone?",
    musicDownloadWifiOnly: "Download on Wi-Fi only", musicDownloadWifiOnlyHint: "Music downloads wait for Wi-Fi instead of using mobile data",
    musicOffline: "Offline · showing your downloads", musicPlayDownloads: "Play downloaded music ({count})",
  },
  pl: {
    musicDownload: "Pobierz", musicDownloaded: "Pobrano", musicDownloading: "Pobieranie…", musicDownloadingCount: "Pobieranie · {done} z {count}",
    musicDownloadFailed: "Nie udało się pobrać · dotknij, aby ponowić", musicRemoveDownload: "Usuń pobrane",
    musicDownloads: "Pobrane", musicDownloadsEmpty: "Pobieraj utwory, albumy i playlisty, aby słuchać ich bez połączenia", musicDownloadSongCount: "Utwory: {count}",
    musicDeleteDownloadConfirm: "Usunąć „{title}” z tego telefonu?", musicDeleteAllDownloadsConfirm: "Usunąć całą pobraną muzykę z tego telefonu?",
    musicDownloadWifiOnly: "Pobieraj tylko przez Wi-Fi", musicDownloadWifiOnlyHint: "Pobieranie muzyki czeka na Wi-Fi zamiast używać danych komórkowych",
    musicOffline: "Offline · pokazuję pobrane", musicPlayDownloads: "Odtwórz pobraną muzykę ({count})",
  },
  de: {
    musicDownload: "Herunterladen", musicDownloaded: "Heruntergeladen", musicDownloading: "Wird heruntergeladen…", musicDownloadingCount: "Wird heruntergeladen · {done} von {count}",
    musicDownloadFailed: "Download fehlgeschlagen · zum Wiederholen tippen", musicRemoveDownload: "Download entfernen",
    musicDownloads: "Downloads", musicDownloadsEmpty: "Lade Songs, Alben und Playlists herunter, um sie ohne Verbindung zu hören", musicDownloadSongCount: "{count} Songs",
    musicDeleteDownloadConfirm: "„{title}“ von diesem Telefon entfernen?", musicDeleteAllDownloadsConfirm: "Alle heruntergeladene Musik von diesem Telefon entfernen?",
    musicDownloadWifiOnly: "Nur über WLAN herunterladen", musicDownloadWifiOnlyHint: "Musik-Downloads warten auf WLAN, statt mobile Daten zu nutzen",
    musicOffline: "Offline · deine Downloads", musicPlayDownloads: "Heruntergeladene Musik abspielen ({count})",
  },
  fr: {
    musicDownload: "Télécharger", musicDownloaded: "Téléchargé", musicDownloading: "Téléchargement…", musicDownloadingCount: "Téléchargement · {done} sur {count}",
    musicDownloadFailed: "Échec du téléchargement · touchez pour réessayer", musicRemoveDownload: "Supprimer le téléchargement",
    musicDownloads: "Téléchargements", musicDownloadsEmpty: "Téléchargez des titres, albums et playlists pour les écouter sans connexion", musicDownloadSongCount: "{count} titres",
    musicDeleteDownloadConfirm: "Supprimer « {title} » de ce téléphone ?", musicDeleteAllDownloadsConfirm: "Supprimer toute la musique téléchargée de ce téléphone ?",
    musicDownloadWifiOnly: "Télécharger en Wi-Fi uniquement", musicDownloadWifiOnlyHint: "Les téléchargements de musique attendent le Wi-Fi au lieu d’utiliser les données mobiles",
    musicOffline: "Hors ligne · vos téléchargements", musicPlayDownloads: "Écouter la musique téléchargée ({count})",
  },
  es: {
    musicDownload: "Descargar", musicDownloaded: "Descargado", musicDownloading: "Descargando…", musicDownloadingCount: "Descargando · {done} de {count}",
    musicDownloadFailed: "Error al descargar · toca para reintentar", musicRemoveDownload: "Quitar descarga",
    musicDownloads: "Descargas", musicDownloadsEmpty: "Descarga canciones, álbumes y listas para escucharlos sin conexión", musicDownloadSongCount: "{count} canciones",
    musicDeleteDownloadConfirm: "¿Quitar «{title}» de este teléfono?", musicDeleteAllDownloadsConfirm: "¿Quitar toda la música descargada de este teléfono?",
    musicDownloadWifiOnly: "Descargar solo con Wi-Fi", musicDownloadWifiOnlyHint: "Las descargas de música esperan al Wi-Fi en lugar de usar datos móviles",
    musicOffline: "Sin conexión · tus descargas", musicPlayDownloads: "Reproducir música descargada ({count})",
  },
  "pt-BR": {
    musicDownload: "Baixar", musicDownloaded: "Baixado", musicDownloading: "Baixando…", musicDownloadingCount: "Baixando · {done} de {count}",
    musicDownloadFailed: "Falha no download · toque para tentar de novo", musicRemoveDownload: "Remover download",
    musicDownloads: "Downloads", musicDownloadsEmpty: "Baixe músicas, álbuns e playlists para ouvir sem conexão", musicDownloadSongCount: "{count} músicas",
    musicDeleteDownloadConfirm: "Remover “{title}” deste celular?", musicDeleteAllDownloadsConfirm: "Remover todas as músicas baixadas deste celular?",
    musicDownloadWifiOnly: "Baixar só no Wi-Fi", musicDownloadWifiOnlyHint: "Os downloads de música esperam o Wi-Fi em vez de usar dados móveis",
    musicOffline: "Off-line · seus downloads", musicPlayDownloads: "Tocar músicas baixadas ({count})",
  },
  ru: {
    musicDownload: "Скачать", musicDownloaded: "Скачано", musicDownloading: "Скачивание…", musicDownloadingCount: "Скачивание · {done} из {count}",
    musicDownloadFailed: "Не удалось скачать · нажмите, чтобы повторить", musicRemoveDownload: "Удалить загрузку",
    musicDownloads: "Загрузки", musicDownloadsEmpty: "Скачивайте треки, альбомы и плейлисты, чтобы слушать их без подключения", musicDownloadSongCount: "Треков: {count}",
    musicDeleteDownloadConfirm: "Удалить «{title}» с этого телефона?", musicDeleteAllDownloadsConfirm: "Удалить всю скачанную музыку с этого телефона?",
    musicDownloadWifiOnly: "Скачивать только по Wi-Fi", musicDownloadWifiOnlyHint: "Загрузки музыки ждут Wi-Fi и не расходуют мобильный трафик",
    musicOffline: "Нет сети · ваши загрузки", musicPlayDownloads: "Слушать скачанную музыку ({count})",
  },
  ja: {
    musicDownload: "ダウンロード", musicDownloaded: "ダウンロード済み", musicDownloading: "ダウンロード中…", musicDownloadingCount: "ダウンロード中 · {done}/{count}",
    musicDownloadFailed: "ダウンロードに失敗しました · タップして再試行", musicRemoveDownload: "ダウンロードを削除",
    musicDownloads: "ダウンロード", musicDownloadsEmpty: "曲、アルバム、プレイリストをダウンロードすると、接続なしで再生できます", musicDownloadSongCount: "{count} 曲",
    musicDeleteDownloadConfirm: "「{title}」をこのスマートフォンから削除しますか？", musicDeleteAllDownloadsConfirm: "ダウンロードしたすべての音楽をこのスマートフォンから削除しますか？",
    musicDownloadWifiOnly: "Wi-Fi のときだけダウンロード", musicDownloadWifiOnlyHint: "音楽のダウンロードはモバイルデータを使わず Wi-Fi を待ちます",
    musicOffline: "オフライン · ダウンロードを表示中", musicPlayDownloads: "ダウンロードした音楽を再生（{count}）",
  },
  hu: {
    musicDownload: "Letöltés", musicDownloaded: "Letöltve", musicDownloading: "Letöltés…", musicDownloadingCount: "Letöltés · {done}/{count}",
    musicDownloadFailed: "A letöltés sikertelen · koppints az újrapróbáláshoz", musicRemoveDownload: "Letöltés eltávolítása",
    musicDownloads: "Letöltések", musicDownloadsEmpty: "Tölts le dalokat, albumokat és lejátszási listákat, hogy kapcsolat nélkül is hallgathasd őket", musicDownloadSongCount: "{count} dal",
    musicDeleteDownloadConfirm: "Eltávolítod a(z) „{title}” elemet erről a telefonról?", musicDeleteAllDownloadsConfirm: "Eltávolítod az összes letöltött zenét erről a telefonról?",
    musicDownloadWifiOnly: "Letöltés csak Wi-Fi-n", musicDownloadWifiOnlyHint: "A zeneletöltések Wi-Fi-re várnak a mobiladat helyett",
    musicOffline: "Offline · a letöltéseid", musicPlayDownloads: "Letöltött zene lejátszása ({count})",
  },
};
