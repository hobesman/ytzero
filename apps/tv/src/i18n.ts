import type { Language } from "./types";
import { searchMessages } from "./searchMessages";
import { emptyMessages } from "./emptyMessages";
import { libraryMessages } from "./libraryMessages";
import { queueMessages } from "./queueMessages";
import { systemProfileMessages } from "./systemProfileMessages";
import { discoveryMessages } from "./discoveryMessages";
import { phoneMessages } from "./phoneMessages";

type DeviceSettingsMessages = {
  devicePlayback: string;
  openDetailsFirst: string;
  openDetailsFirstHint: string;
  deviceSettingsTitle: string;
  deviceSettingsDescription: string;
  connection: string;
  currentInstance: string;
  changeInstanceHint: string;
  session: string;
  signOutHint: string;
  more: string;
  less: string;
};

const deviceSettingsMessages: Record<Language, DeviceSettingsMessages> = {
  en: {
    devicePlayback: "Playback", openDetailsFirst: "Open details before playback", openDetailsFirstHint: "Applies to this television. By default, selecting a video starts playback immediately.",
    deviceSettingsTitle: "Settings", deviceSettingsDescription: "Connection and session settings for this television.", connection: "Connection", currentInstance: "Current instance", changeInstanceHint: "Forget this address and connect the television to another YT Zero instance.", session: "Session", signOutHint: "Remove this television's access to the current profile.", more: "More", less: "Less",
  },
  pl: {
    devicePlayback: "Odtwarzanie", openDetailsFirst: "Otwieraj szczegóły przed odtwarzaniem", openDetailsFirstHint: "Dotyczy tego telewizora. Domyślnie wybranie filmu od razu rozpoczyna odtwarzanie.",
    deviceSettingsTitle: "Ustawienia", deviceSettingsDescription: "Połączenie i sesja tego telewizora.", connection: "Połączenie", currentInstance: "Bieżąca instancja", changeInstanceHint: "Usuń ten adres i połącz telewizor z inną instancją YT Zero.", session: "Sesja", signOutHint: "Usuń dostęp tego telewizora do bieżącego profilu.", more: "Więcej", less: "Mniej",
  },
  de: {
    devicePlayback: "Wiedergabe", openDetailsFirst: "Details vor der Wiedergabe öffnen", openDetailsFirstHint: "Gilt für diesen Fernseher. Standardmäßig startet die Auswahl eines Videos sofort die Wiedergabe.",
    deviceSettingsTitle: "Einstellungen", deviceSettingsDescription: "Verbindungs- und Sitzungseinstellungen für diesen Fernseher.", connection: "Verbindung", currentInstance: "Aktuelle Instanz", changeInstanceHint: "Diese Adresse entfernen und den Fernseher mit einer anderen YT-Zero-Instanz verbinden.", session: "Sitzung", signOutHint: "Den Zugriff dieses Fernsehers auf das aktuelle Profil entfernen.", more: "Mehr", less: "Weniger",
  },
  fr: {
    devicePlayback: "Lecture", openDetailsFirst: "Ouvrir les détails avant la lecture", openDetailsFirstHint: "S’applique à ce téléviseur. Par défaut, sélectionner une vidéo lance immédiatement la lecture.",
    deviceSettingsTitle: "Réglages", deviceSettingsDescription: "Connexion et session de ce téléviseur.", connection: "Connexion", currentInstance: "Instance actuelle", changeInstanceHint: "Oublier cette adresse et connecter le téléviseur à une autre instance YT Zero.", session: "Session", signOutHint: "Supprimer l’accès de ce téléviseur au profil actuel.", more: "Plus", less: "Moins",
  },
  es: {
    devicePlayback: "Reproducción", openDetailsFirst: "Abrir los detalles antes de reproducir", openDetailsFirstHint: "Se aplica a este televisor. De forma predeterminada, seleccionar un vídeo inicia la reproducción inmediatamente.",
    deviceSettingsTitle: "Ajustes", deviceSettingsDescription: "Conexión y sesión de este televisor.", connection: "Conexión", currentInstance: "Instancia actual", changeInstanceHint: "Olvida esta dirección y conecta el televisor a otra instancia de YT Zero.", session: "Sesión", signOutHint: "Elimina el acceso de este televisor al perfil actual.", more: "Más", less: "Menos",
  },
  "pt-BR": {
    devicePlayback: "Reprodução", openDetailsFirst: "Abrir detalhes antes de reproduzir", openDetailsFirstHint: "Aplica-se a esta televisão. Por padrão, selecionar um vídeo inicia a reprodução imediatamente.",
    deviceSettingsTitle: "Configurações", deviceSettingsDescription: "Conexão e sessão desta televisão.", connection: "Conexão", currentInstance: "Instância atual", changeInstanceHint: "Esqueça este endereço e conecte a televisão a outra instância do YT Zero.", session: "Sessão", signOutHint: "Remova o acesso desta televisão ao perfil atual.", more: "Mais", less: "Menos",
  },
  ru: {
    devicePlayback: "Воспроизведение", openDetailsFirst: "Открывать сведения перед воспроизведением", openDetailsFirstHint: "Применяется к этому телевизору. По умолчанию выбор видео сразу запускает воспроизведение.",
    deviceSettingsTitle: "Настройки", deviceSettingsDescription: "Подключение и сеанс этого телевизора.", connection: "Подключение", currentInstance: "Текущая установка", changeInstanceHint: "Удалить этот адрес и подключить телевизор к другой установке YT Zero.", session: "Сеанс", signOutHint: "Удалить доступ этого телевизора к текущему профилю.", more: "Ещё", less: "Скрыть",
  },
  ja: {
    devicePlayback: "再生", openDetailsFirst: "再生前に詳細を開く", openDetailsFirstHint: "このテレビに適用されます。初期設定では、動画を選択するとすぐに再生が始まります。",
    deviceSettingsTitle: "設定", deviceSettingsDescription: "このテレビの接続とセッションの設定です。", connection: "接続", currentInstance: "現在のインスタンス", changeInstanceHint: "このアドレスを削除し、別の YT Zero インスタンスに接続します。", session: "セッション", signOutHint: "このテレビから現在のプロフィールへのアクセスを削除します。", more: "その他", less: "閉じる",
  },
  hu: {
    devicePlayback: "Lejátszás", openDetailsFirst: "Részletek megnyitása lejátszás előtt", openDetailsFirstHint: "Erre a televízióra érvényes. Alapértelmezés szerint a videó kiválasztása azonnal elindítja a lejátszást.",
    deviceSettingsTitle: "Beállítások", deviceSettingsDescription: "A televízió kapcsolati és munkamenet-beállításai.", connection: "Kapcsolat", currentInstance: "Jelenlegi példány", changeInstanceHint: "A cím törlése és a televízió csatlakoztatása egy másik YT Zero-példányhoz.", session: "Munkamenet", signOutHint: "A televízió hozzáférésének eltávolítása a jelenlegi profilhoz.", more: "Továbbiak", less: "Kevesebb",
  },
};

type NavigationMessages = {
  navToday: string;
  navRecommendations: string;
  navShorts: string;
  navLive: string;
  navWatchlist: string;
  navFollowedPlaylists: string;
  navDownloads: string;
  navLiked: string;
  navHistory: string;
  navBookmarks: string;
  navArchive: string;
  navSettings: string;
};

const navigationMessages: Record<Language, NavigationMessages> = {
  en: { navToday: "Main", navRecommendations: "Recommendations", navShorts: "Shorts", navLive: "Live", navWatchlist: "Scheduled", navFollowedPlaylists: "Followed playlists", navDownloads: "Downloads", navLiked: "Liked", navHistory: "History", navBookmarks: "Bookmarks", navArchive: "Rejected", navSettings: "Settings" },
  pl: { navToday: "Główna", navRecommendations: "Rekomendacje", navShorts: "Shorts", navLive: "Na żywo", navWatchlist: "Zaplanowane", navFollowedPlaylists: "Obserwowane playlisty", navDownloads: "Pobrane", navLiked: "Polubione", navHistory: "Historia", navBookmarks: "Zakładki", navArchive: "Odrzucone", navSettings: "Ustawienia" },
  de: { navToday: "Start", navRecommendations: "Empfehlungen", navShorts: "Shorts", navLive: "Live", navWatchlist: "Geplant", navFollowedPlaylists: "Gefolgte Playlists", navDownloads: "Downloads", navLiked: "Favoriten", navHistory: "Verlauf", navBookmarks: "Lesezeichen", navArchive: "Archiv", navSettings: "Einstellungen" },
  fr: { navToday: "Accueil", navRecommendations: "Recommandations", navShorts: "Shorts", navLive: "En direct", navWatchlist: "À regarder", navFollowedPlaylists: "Playlists suivies", navDownloads: "Téléchargements", navLiked: "J'aime", navHistory: "Historique", navBookmarks: "Signets", navArchive: "Rejetées", navSettings: "Paramètres" },
  es: { navToday: "Inicio", navRecommendations: "Recomendaciones", navShorts: "Shorts", navLive: "En directo", navWatchlist: "Programados", navFollowedPlaylists: "Listas seguidas", navDownloads: "Descargas", navLiked: "Me gusta", navHistory: "Historial", navBookmarks: "Marcadores", navArchive: "Descartados", navSettings: "Ajustes" },
  "pt-BR": { navToday: "Principal", navRecommendations: "Recomendações", navShorts: "Calções", navLive: "Vivo", navWatchlist: "Agendado", navFollowedPlaylists: "Listas de reprodução seguidas", navDownloads: "Transferências", navLiked: "Gostou", navHistory: "Histórico", navBookmarks: "Favoritos", navArchive: "Rejeitado", navSettings: "Configuração" },
  ru: { navToday: "Главная", navRecommendations: "Рекомендации", navShorts: "Шорты", navLive: "Трансляции", navWatchlist: "Запланировано", navFollowedPlaylists: "Отслеживаемые плейлисты", navDownloads: "Загрузки", navLiked: "Понравившиеся", navHistory: "История", navBookmarks: "Закладки", navArchive: "Отклонённые", navSettings: "Настройки" },
  ja: { navToday: "メインページ", navRecommendations: "推奨事項", navShorts: "ショートパンツ", navLive: "ライブ", navWatchlist: "スケジュール", navFollowedPlaylists: "フォローされたプレイリスト", navDownloads: "ダウンロード", navLiked: "ログイン", navHistory: "プロフィール", navBookmarks: "ブックマーク", navArchive: "注入される", navSettings: "コンテンツ" },
  hu: { navToday: "Kezdőlap", navRecommendations: "Ajánlások", navShorts: "Shorts", navLive: "Élő", navWatchlist: "Ütemezve", navFollowedPlaylists: "Követett lejátszási listák", navDownloads: "Letöltések", navLiked: "Kedvelések", navHistory: "Előzmények", navBookmarks: "Könyvjelzők", navArchive: "Elutasítva", navSettings: "Beállítások" },
};

type ProfileMessages = {
  profiles: string;
  currentProfile: string;
  switchProfile: string;
  switchingProfile: string;
  enterProfilePin: string;
  enterChildLockPin: string;
  invalidPin: string;
  profileLocked: string;
  incognitoMode: string;
  incognitoModeHint: string;
  cancel: string;
};

const profileMessages: Record<Language, ProfileMessages> = {
  en: { profiles: "Profiles", currentProfile: "Current profile", switchProfile: "Switch profile", switchingProfile: "Switching…", enterProfilePin: "Enter PIN to switch", enterChildLockPin: "Enter the child lock PIN", invalidPin: "The PIN is incorrect. Try again.", profileLocked: "This profile is locked", incognitoMode: "Incognito mode", incognitoModeHint: "Do not save watch history, progress, or viewing insights on this television.", cancel: "Cancel" },
  pl: { profiles: "Profile", currentProfile: "Bieżący profil", switchProfile: "Zmień profil", switchingProfile: "Przełączanie…", enterProfilePin: "Wpisz PIN, aby przełączyć", enterChildLockPin: "Wpisz PIN blokady rodzicielskiej", invalidPin: "PIN jest nieprawidłowy. Spróbuj ponownie.", profileLocked: "Ten profil jest zablokowany", incognitoMode: "Tryb incognito", incognitoModeHint: "Nie zapisuj historii, postępu ani statystyk oglądania na tym telewizorze.", cancel: "Anuluj" },
  de: { profiles: "Profile", currentProfile: "Aktuelles Profil", switchProfile: "Profil wechseln", switchingProfile: "Profil wird gewechselt…", enterProfilePin: "PIN zum Wechseln eingeben", enterChildLockPin: "Kindersicherungs-PIN eingeben", invalidPin: "Die PIN ist falsch. Versuche es erneut.", profileLocked: "Dieses Profil ist gesperrt", incognitoMode: "Inkognitomodus", incognitoModeHint: "Wiedergabeverlauf, Fortschritt und Wiedergabestatistiken auf diesem Fernseher nicht speichern.", cancel: "Abbrechen" },
  fr: { profiles: "Profils", currentProfile: "Profil actuel", switchProfile: "Changer de profil", switchingProfile: "Changement…", enterProfilePin: "Saisissez le code PIN pour changer", enterChildLockPin: "Saisissez le code PIN du contrôle parental", invalidPin: "Le code PIN est incorrect. Réessayez.", profileLocked: "Ce profil est verrouillé", incognitoMode: "Mode Incognito", incognitoModeHint: "Ne pas enregistrer l’historique, la progression ni les statistiques sur ce téléviseur.", cancel: "Annuler" },
  es: { profiles: "Perfiles", currentProfile: "Perfil actual", switchProfile: "Cambiar de perfil", switchingProfile: "Cambiando…", enterProfilePin: "Introduce el PIN para cambiar", enterChildLockPin: "Introduce el PIN del bloqueo infantil", invalidPin: "El PIN es incorrecto. Inténtalo de nuevo.", profileLocked: "Este perfil está bloqueado", incognitoMode: "Modo incógnito", incognitoModeHint: "No guardar el historial, el progreso ni las estadísticas de visualización en este televisor.", cancel: "Cancelar" },
  "pt-BR": { profiles: "Perfis", currentProfile: "Perfil atual", switchProfile: "Mudar de perfil", switchingProfile: "Mudando…", enterProfilePin: "Digite o PIN para mudar", enterChildLockPin: "Digite o PIN do controle parental", invalidPin: "O PIN está incorreto. Tente novamente.", profileLocked: "Este perfil está bloqueado", incognitoMode: "Modo incógnito", incognitoModeHint: "Não salvar o histórico, o progresso nem as estatísticas de visualização nesta televisão.", cancel: "Cancelar" },
  ru: { profiles: "Профили", currentProfile: "Текущий профиль", switchProfile: "Сменить профиль", switchingProfile: "Переключение…", enterProfilePin: "Введите PIN-код для переключения", enterChildLockPin: "Введите PIN-код родительской блокировки", invalidPin: "Неверный PIN-код. Попробуйте ещё раз.", profileLocked: "Этот профиль заблокирован", incognitoMode: "Режим инкогнито", incognitoModeHint: "Не сохранять историю, прогресс и статистику просмотров на этом телевизоре.", cancel: "Отмена" },
  ja: { profiles: "プロフィール", currentProfile: "現在のプロフィール", switchProfile: "プロフィールを切り替える", switchingProfile: "切り替え中…", enterProfilePin: "切り替えるには PIN を入力", enterChildLockPin: "ペアレンタルロックの PIN を入力", invalidPin: "PIN が正しくありません。もう一度お試しください。", profileLocked: "このプロフィールはロックされています", incognitoMode: "シークレットモード", incognitoModeHint: "このテレビに再生履歴、進捗、視聴分析を保存しません。", cancel: "キャンセル" },
  hu: { profiles: "Profilok", currentProfile: "Jelenlegi profil", switchProfile: "Profilváltás", switchingProfile: "Váltás…", enterProfilePin: "Add meg a PIN-kódot a váltáshoz", enterChildLockPin: "Add meg a gyermekzár PIN-kódját", invalidPin: "A PIN-kód helytelen. Próbáld újra.", profileLocked: "Ez a profil zárolva van", incognitoMode: "Inkognitó mód", incognitoModeHint: "Ne mentse a megtekintési előzményeket, az előrehaladást és a statisztikákat ezen a televízión.", cancel: "Mégsem" },
};

type BookmarkMessages = {
  bookmarksDescription: string;
  loadingBookmarks: string;
  bookmarksEmpty: string;
  bookmarksEmptyHint: string;
  bookmarksLoadError: string;
  bookmarkSavedMoment: string;
};

const bookmarkMessages: Record<Language, BookmarkMessages> = {
  en: { bookmarksDescription: "Saved moments with enough context to pick up exactly where you left off.", loadingBookmarks: "Loading bookmarks…", bookmarksEmpty: "No bookmarks yet", bookmarksEmptyHint: "Open a video and use the more actions menu to save a timestamp and a short note.", bookmarksLoadError: "Bookmarks could not be loaded.", bookmarkSavedMoment: "Saved moment" },
  pl: { bookmarksDescription: "Zapisane momenty z kontekstem, który pozwala wrócić dokładnie tam, gdzie chcesz.", loadingBookmarks: "Ładowanie zakładek…", bookmarksEmpty: "Nie masz jeszcze zakładek", bookmarksEmptyHint: "Otwórz film i użyj menu Więcej, aby zapisać czas oraz krótką notatkę.", bookmarksLoadError: "Nie udało się wczytać zakładek.", bookmarkSavedMoment: "Zapisany moment" },
  de: { bookmarksDescription: "Gespeicherte Momente mit genügend Kontext, um genau dort weiterzumachen.", loadingBookmarks: "Lesezeichen werden geladen…", bookmarksEmpty: "Noch keine Lesezeichen", bookmarksEmptyHint: "Öffne ein Video und speichere über das Menü Weitere Aktionen einen Zeitpunkt und eine kurze Notiz.", bookmarksLoadError: "Lesezeichen konnten nicht geladen werden.", bookmarkSavedMoment: "Gespeicherter Moment" },
  fr: { bookmarksDescription: "Moments enregistrés avec assez de contexte pour reprendre exactement là où vous vous étiez arrêté.", loadingBookmarks: "Chargement des signets…", bookmarksEmpty: "Aucun signet", bookmarksEmptyHint: "Ouvrez une vidéo, puis utilisez le menu d’actions pour enregistrer un instant et une courte note.", bookmarksLoadError: "Impossible de charger les signets.", bookmarkSavedMoment: "Moment enregistré" },
  es: { bookmarksDescription: "Momentos guardados con contexto suficiente para retomarlos justo donde los dejaste.", loadingBookmarks: "Cargando marcadores…", bookmarksEmpty: "Aún no hay marcadores", bookmarksEmptyHint: "Abre un vídeo y usa el menú de más acciones para guardar un instante y una nota breve.", bookmarksLoadError: "No se han podido cargar los marcadores.", bookmarkSavedMoment: "Momento guardado" },
  "pt-BR": { bookmarksDescription: "Momentos salvos com contexto suficiente para retomar exatamente de onde você parou.", loadingBookmarks: "Carregando favoritos…", bookmarksEmpty: "Ainda não há favoritos", bookmarksEmptyHint: "Abra um vídeo e use o menu de mais ações para salvar um instante e uma nota curta.", bookmarksLoadError: "Não foi possível carregar os favoritos.", bookmarkSavedMoment: "Momento salvo" },
  ru: { bookmarksDescription: "Сохранённые моменты с контекстом, чтобы легко продолжить с нужного места.", loadingBookmarks: "Загрузка закладок…", bookmarksEmpty: "Закладок пока нет", bookmarksEmptyHint: "Откройте видео и сохраните временную метку с короткой заметкой через меню дополнительных действий.", bookmarksLoadError: "Не удалось загрузить закладки.", bookmarkSavedMoment: "Сохранённый момент" },
  ja: { bookmarksDescription: "保存した場面を、必要な文脈と一緒に振り返れます。", loadingBookmarks: "ブックマークを読み込み中…", bookmarksEmpty: "ブックマークはまだありません", bookmarksEmptyHint: "動画を開き、その他の操作メニューから時刻と短いメモを保存してください。", bookmarksLoadError: "ブックマークを読み込めませんでした。", bookmarkSavedMoment: "保存した場面" },
  hu: { bookmarksDescription: "Elmentett pillanatok, amelyekhez elegendő kontextus tartozik ahhoz, hogy pontosan ott folytathasd, ahol abbahagytad.", loadingBookmarks: "Könyvjelzők betöltése…", bookmarksEmpty: "Még nincsenek könyvjelzők", bookmarksEmptyHint: "Nyiss meg egy videót, majd a További műveletek menüben ments el egy időbélyeget és egy rövid megjegyzést.", bookmarksLoadError: "A könyvjelzők betöltése nem sikerült.", bookmarkSavedMoment: "Mentett pillanat" },
};

type ChannelMessages = {
  loadingChannel: string;
  channelLoadError: string;
  videos: string;
  subscribers: string;
  follow: string;
  unfollow: string;
  channelInactive: string;
  channelFollowError: string;
  channelVideosEmpty: string;
  channelShortsEmpty: string;
};

const channelMessages: Record<Language, ChannelMessages> = {
  en: { loadingChannel: "Loading channel…", channelLoadError: "The channel could not be loaded.", videos: "Videos", subscribers: "subscribers", follow: "Follow", unfollow: "Unfollow", channelInactive: "Channel syncing is disabled in the main instance settings.", channelFollowError: "The subscription could not be changed.", channelVideosEmpty: "No videos from this channel.", channelShortsEmpty: "No Shorts from this channel." },
  pl: { loadingChannel: "Ładowanie kanału…", channelLoadError: "Nie udało się wczytać kanału.", videos: "Filmy", subscribers: "subskrybentów", follow: "Obserwuj", unfollow: "Przestań obserwować", channelInactive: "Synchronizacja kanału jest wyłączona w ustawieniach głównej instancji.", channelFollowError: "Nie udało się zmienić obserwowania kanału.", channelVideosEmpty: "Brak filmów z tego kanału.", channelShortsEmpty: "Brak Shortsów z tego kanału." },
  de: { loadingChannel: "Kanal wird geladen…", channelLoadError: "Der Kanal konnte nicht geladen werden.", videos: "Videos", subscribers: "Abonnenten", follow: "Folgen", unfollow: "Entfolgen", channelInactive: "Die Kanalsynchronisierung ist in den Einstellungen der Hauptinstanz deaktiviert.", channelFollowError: "Das Abonnement konnte nicht geändert werden.", channelVideosEmpty: "Keine Videos von diesem Kanal.", channelShortsEmpty: "Keine Shorts von diesem Kanal." },
  fr: { loadingChannel: "Chargement de la chaîne…", channelLoadError: "Impossible de charger la chaîne.", videos: "Vidéos", subscribers: "abonnés", follow: "Suivre", unfollow: "Ne plus suivre", channelInactive: "La synchronisation de la chaîne est désactivée dans les réglages de l’instance principale.", channelFollowError: "Impossible de modifier l’abonnement.", channelVideosEmpty: "Aucune vidéo de cette chaîne.", channelShortsEmpty: "Aucun Short de cette chaîne." },
  es: { loadingChannel: "Cargando el canal…", channelLoadError: "No se ha podido cargar el canal.", videos: "Vídeos", subscribers: "suscriptores", follow: "Seguir", unfollow: "Dejar de seguir", channelInactive: "La sincronización del canal está desactivada en los ajustes de la instancia principal.", channelFollowError: "No se ha podido cambiar la suscripción.", channelVideosEmpty: "No hay vídeos de este canal.", channelShortsEmpty: "No hay Shorts de este canal." },
  "pt-BR": { loadingChannel: "Carregando o canal…", channelLoadError: "Não foi possível carregar o canal.", videos: "Vídeos", subscribers: "assinantes", follow: "Seguir", unfollow: "Deixar de seguir", channelInactive: "A sincronização do canal está desativada nas configurações da instância principal.", channelFollowError: "Não foi possível alterar a inscrição.", channelVideosEmpty: "Não há vídeos deste canal.", channelShortsEmpty: "Não há Shorts deste canal." },
  ru: { loadingChannel: "Загрузка канала…", channelLoadError: "Не удалось загрузить канал.", videos: "Видео", subscribers: "подписчиков", follow: "Подписаться", unfollow: "Отписаться", channelInactive: "Синхронизация канала отключена в настройках основной установки.", channelFollowError: "Не удалось изменить подписку.", channelVideosEmpty: "На этом канале нет видео.", channelShortsEmpty: "На этом канале нет Shorts." },
  ja: { loadingChannel: "チャンネルを読み込み中…", channelLoadError: "チャンネルを読み込めませんでした。", videos: "動画", subscribers: "人の登録者", follow: "フォロー", unfollow: "フォロー解除", channelInactive: "メインインスタンスの設定でチャンネル同期が無効になっています。", channelFollowError: "フォロー状態を変更できませんでした。", channelVideosEmpty: "このチャンネルの動画はありません。", channelShortsEmpty: "このチャンネルの Shorts はありません。" },
  hu: { loadingChannel: "Csatorna betöltése…", channelLoadError: "A csatorna nem tölthető be.", videos: "Videók", subscribers: "feliratkozó", follow: "Követés", unfollow: "Követés megszüntetése", channelInactive: "A csatorna szinkronizálása ki van kapcsolva a fő példány beállításaiban.", channelFollowError: "A követési állapot nem módosítható.", channelVideosEmpty: "Nincsenek videók ettől a csatornától.", channelShortsEmpty: "Nincsenek Shorts videók ettől a csatornától." },
};

type PlaybackMessages = {
  playVideo: string;
  resumePlayback: string;
  playFromStart: string;
  preparingPlayback: string;
  playbackErrorTitle: string;
  playbackError: string;
  playbackUnavailable: string;
  playbackRestricted: string;
  playbackSessionExpired: string;
  playbackSaveError: string;
  featuredVideo: string;
  videoDetails: string;
};

const playbackMessages: Record<Language, PlaybackMessages> = {
  "en": {
    playVideo: "Play",
    resumePlayback: "Resume",
    playFromStart: "Start over",
    preparingPlayback: "Preparing playback…",
    playbackErrorTitle: "Unable to play",
    playbackError: "Playback was interrupted. Check your connection and try again.",
    playbackUnavailable: "No native stream is available for this video. Download it on your YT Zero instance and try again.",
    playbackRestricted: "Playback is restricted for this profile.",
    playbackSessionExpired: "Playback access has expired. Try again, or pair this television again in Settings.",
    playbackSaveError: "Your last playback position could not be saved.",
    featuredVideo: "Ready to watch",
    videoDetails: "Details",
  },
  "pl": {
    playVideo: "Odtwórz",
    resumePlayback: "Kontynuuj",
    playFromStart: "Od początku",
    preparingPlayback: "Przygotowywanie odtwarzania…",
    playbackErrorTitle: "Nie można odtworzyć filmu",
    playbackError: "Odtwarzanie zostało przerwane. Sprawdź połączenie i spróbuj ponownie.",
    playbackUnavailable: "Ten film nie ma dostępnego strumienia do odtwarzania na TV. Pobierz go w swojej instancji YT Zero i spróbuj ponownie.",
    playbackRestricted: "Odtwarzanie jest ograniczone dla tego profilu.",
    playbackSessionExpired: "Dostęp do odtwarzania wygasł. Spróbuj ponownie lub sparuj telewizor ponownie w Ustawieniach.",
    playbackSaveError: "Nie udało się zapisać ostatniej pozycji odtwarzania.",
    featuredVideo: "Do obejrzenia",
    videoDetails: "Szczegóły",
  },
  "de": {
    playVideo: "Abspielen",
    resumePlayback: "Fortsetzen",
    playFromStart: "Von Anfang an",
    preparingPlayback: "Wiedergabe wird vorbereitet…",
    playbackErrorTitle: "Wiedergabe nicht möglich",
    playbackError: "Die Wiedergabe wurde unterbrochen. Prüfe deine Verbindung und versuche es erneut.",
    playbackUnavailable: "Für dieses Video ist kein nativer Stream verfügbar. Lade es in deiner YT Zero-Instanz herunter und versuche es erneut.",
    playbackRestricted: "Die Wiedergabe ist für dieses Profil eingeschränkt.",
    playbackSessionExpired: "Der Wiedergabezugriff ist abgelaufen. Versuche es erneut oder kopple den Fernseher in den Einstellungen erneut.",
    playbackSaveError: "Die letzte Wiedergabeposition konnte nicht gespeichert werden.",
    featuredVideo: "Bereit zum Ansehen",
    videoDetails: "Details",
  },
  "fr": {
    playVideo: "Lire",
    resumePlayback: "Reprendre",
    playFromStart: "Depuis le début",
    preparingPlayback: "Préparation de la lecture…",
    playbackErrorTitle: "Lecture impossible",
    playbackError: "La lecture a été interrompue. Vérifie ta connexion et réessaie.",
    playbackUnavailable: "Aucun flux natif n’est disponible pour cette vidéo. Télécharge-la sur ton instance YT Zero et réessaie.",
    playbackRestricted: "La lecture est restreinte pour ce profil.",
    playbackSessionExpired: "L’accès à la lecture a expiré. Réessaie ou associe à nouveau ce téléviseur dans les réglages.",
    playbackSaveError: "La dernière position de lecture n’a pas pu être enregistrée.",
    featuredVideo: "À regarder",
    videoDetails: "Détails",
  },
  "es": {
    playVideo: "Reproducir",
    resumePlayback: "Continuar",
    playFromStart: "Desde el principio",
    preparingPlayback: "Preparando la reproducción…",
    playbackErrorTitle: "No se puede reproducir",
    playbackError: "La reproducción se ha interrumpido. Comprueba la conexión y vuelve a intentarlo.",
    playbackUnavailable: "No hay una transmisión nativa disponible para este vídeo. Descárgalo en tu instancia de YT Zero y vuelve a intentarlo.",
    playbackRestricted: "La reproducción está restringida para este perfil.",
    playbackSessionExpired: "El acceso a la reproducción ha caducado. Vuelve a intentarlo o empareja el televisor de nuevo en Ajustes.",
    playbackSaveError: "No se ha podido guardar la última posición de reproducción.",
    featuredVideo: "Listo para ver",
    videoDetails: "Detalles",
  },
  "pt-BR": {
    playVideo: "Reproduzir",
    resumePlayback: "Continuar",
    playFromStart: "Do início",
    preparingPlayback: "Preparando a reprodução…",
    playbackErrorTitle: "Não foi possível reproduzir",
    playbackError: "A reprodução foi interrompida. Verifique sua conexão e tente novamente.",
    playbackUnavailable: "Nenhuma transmissão nativa está disponível para este vídeo. Baixe-o na sua instância do YT Zero e tente novamente.",
    playbackRestricted: "A reprodução está restrita para este perfil.",
    playbackSessionExpired: "O acesso à reprodução expirou. Tente novamente ou emparelhe esta televisão novamente nas Configurações.",
    playbackSaveError: "Não foi possível salvar a última posição de reprodução.",
    featuredVideo: "Pronto para assistir",
    videoDetails: "Detalhes",
  },
  "ru": {
    playVideo: "Смотреть",
    resumePlayback: "Продолжить",
    playFromStart: "С начала",
    preparingPlayback: "Подготовка воспроизведения…",
    playbackErrorTitle: "Не удалось воспроизвести",
    playbackError: "Воспроизведение прервано. Проверьте подключение и повторите попытку.",
    playbackUnavailable: "Для этого видео нет доступного нативного потока. Скачайте его в своей установке YT Zero и повторите попытку.",
    playbackRestricted: "Воспроизведение ограничено для этого профиля.",
    playbackSessionExpired: "Срок доступа к воспроизведению истёк. Повторите попытку или заново подключите телевизор в настройках.",
    playbackSaveError: "Не удалось сохранить последнюю позицию воспроизведения.",
    featuredVideo: "Можно посмотреть",
    videoDetails: "Подробнее",
  },
  "ja": {
    playVideo: "再生",
    resumePlayback: "続きから再生",
    playFromStart: "最初から再生",
    preparingPlayback: "再生を準備中…",
    playbackErrorTitle: "再生できません",
    playbackError: "再生が中断されました。接続を確認して、もう一度お試しください。",
    playbackUnavailable: "この動画にはネイティブ再生用のストリームがありません。YT Zero インスタンスでダウンロードして、もう一度お試しください。",
    playbackRestricted: "このプロフィールでは再生が制限されています。",
    playbackSessionExpired: "再生アクセスの有効期限が切れました。再試行するか、設定でテレビを再度ペアリングしてください。",
    playbackSaveError: "最後の再生位置を保存できませんでした。",
    featuredVideo: "視聴できる動画",
    videoDetails: "詳細",
  },
  "hu": {
    playVideo: "Lejátszás",
    resumePlayback: "Folytatás",
    playFromStart: "Elölről",
    preparingPlayback: "Lejátszás előkészítése…",
    playbackErrorTitle: "Nem játszható le",
    playbackError: "A lejátszás megszakadt. Ellenőrizd a kapcsolatot, majd próbáld újra.",
    playbackUnavailable: "Ehhez a videóhoz nem érhető el natív adatfolyam. Töltsd le a YT Zero-példányodon, majd próbáld újra.",
    playbackRestricted: "A lejátszás korlátozott ennél a profilnál.",
    playbackSessionExpired: "A lejátszási hozzáférés lejárt. Próbáld újra, vagy párosítsd újra a televíziót a Beállításokban.",
    playbackSaveError: "Az utolsó lejátszási pozíciót nem sikerült menteni.",
    featuredVideo: "Megtekintésre kész",
    videoDetails: "Részletek",
  },
};

type WatchMessages = {
  loadingVideo: string;
  videoLoadError: string;
  tryAgain: string;
  markUnwatched: string;
  like: string;
  unlike: string;
  scheduleToday: string;
  removeSchedule: string;
  restoreVideo: string;
  descriptionTitle: string;
  relatedVideos: string;
  commentsTitle: string;
  loadComments: string;
  loadingComments: string;
  commentsEmpty: string;
  commentsLoadError: string;
  views: string;
  membersOnly: string;
  privateVideo: string;
  pinnedComment: string;
  creatorComment: string;
};

const watchMessages: Record<Language, WatchMessages> = {
  en: { loadingVideo: "Loading video…", videoLoadError: "This video could not be loaded.", tryAgain: "Try again", markUnwatched: "Mark unwatched", like: "Like", unlike: "Unlike", scheduleToday: "Plan for today", removeSchedule: "Remove from planned", restoreVideo: "Restore", descriptionTitle: "Description", relatedVideos: "Up next", commentsTitle: "Comments", loadComments: "Load comments", loadingComments: "Loading comments…", commentsEmpty: "No comments to show.", commentsLoadError: "Comments could not be loaded.", views: "views", membersOnly: "Members only", privateVideo: "Private", pinnedComment: "Pinned", creatorComment: "Creator" },
  pl: { loadingVideo: "Ładowanie filmu…", videoLoadError: "Nie udało się wczytać tego filmu.", tryAgain: "Spróbuj ponownie", markUnwatched: "Oznacz jako nieobejrzane", like: "Polub", unlike: "Usuń polubienie", scheduleToday: "Zaplanuj na dziś", removeSchedule: "Usuń z zaplanowanych", restoreVideo: "Przywróć", descriptionTitle: "Opis", relatedVideos: "Obejrzyj następnie", commentsTitle: "Komentarze", loadComments: "Wczytaj komentarze", loadingComments: "Ładowanie komentarzy…", commentsEmpty: "Brak komentarzy do wyświetlenia.", commentsLoadError: "Nie udało się wczytać komentarzy.", views: "wyświetleń", membersOnly: "Tylko dla wspierających", privateVideo: "Prywatny", pinnedComment: "Przypięty", creatorComment: "Twórca" },
  de: { loadingVideo: "Video wird geladen…", videoLoadError: "Dieses Video konnte nicht geladen werden.", tryAgain: "Erneut versuchen", markUnwatched: "Als ungesehen markieren", like: "Gefällt mir", unlike: "Gefällt mir entfernen", scheduleToday: "Für heute planen", removeSchedule: "Aus Geplant entfernen", restoreVideo: "Wiederherstellen", descriptionTitle: "Beschreibung", relatedVideos: "Als Nächstes", commentsTitle: "Kommentare", loadComments: "Kommentare laden", loadingComments: "Kommentare werden geladen…", commentsEmpty: "Keine Kommentare vorhanden.", commentsLoadError: "Kommentare konnten nicht geladen werden.", views: "Aufrufe", membersOnly: "Nur für Mitglieder", privateVideo: "Privat", pinnedComment: "Angeheftet", creatorComment: "Ersteller" },
  fr: { loadingVideo: "Chargement de la vidéo…", videoLoadError: "Impossible de charger cette vidéo.", tryAgain: "Réessayer", markUnwatched: "Marquer comme non regardée", like: "J’aime", unlike: "Retirer J’aime", scheduleToday: "Planifier pour aujourd’hui", removeSchedule: "Retirer des vidéos planifiées", restoreVideo: "Restaurer", descriptionTitle: "Description", relatedVideos: "À suivre", commentsTitle: "Commentaires", loadComments: "Charger les commentaires", loadingComments: "Chargement des commentaires…", commentsEmpty: "Aucun commentaire à afficher.", commentsLoadError: "Impossible de charger les commentaires.", views: "vues", membersOnly: "Réservée aux membres", privateVideo: "Privée", pinnedComment: "Épinglé", creatorComment: "Créateur" },
  es: { loadingVideo: "Cargando vídeo…", videoLoadError: "No se ha podido cargar este vídeo.", tryAgain: "Reintentar", markUnwatched: "Marcar como no visto", like: "Me gusta", unlike: "Quitar Me gusta", scheduleToday: "Programar para hoy", removeSchedule: "Quitar de programados", restoreVideo: "Restaurar", descriptionTitle: "Descripción", relatedVideos: "A continuación", commentsTitle: "Comentarios", loadComments: "Cargar comentarios", loadingComments: "Cargando comentarios…", commentsEmpty: "No hay comentarios para mostrar.", commentsLoadError: "No se han podido cargar los comentarios.", views: "visualizaciones", membersOnly: "Solo para miembros", privateVideo: "Privado", pinnedComment: "Fijado", creatorComment: "Creador" },
  "pt-BR": { loadingVideo: "Carregando vídeo…", videoLoadError: "Não foi possível carregar este vídeo.", tryAgain: "Tentar novamente", markUnwatched: "Marcar como não assistido", like: "Curtir", unlike: "Remover curtida", scheduleToday: "Planejar para hoje", removeSchedule: "Remover dos planejados", restoreVideo: "Restaurar", descriptionTitle: "Descrição", relatedVideos: "A seguir", commentsTitle: "Comentários", loadComments: "Carregar comentários", loadingComments: "Carregando comentários…", commentsEmpty: "Nenhum comentário para mostrar.", commentsLoadError: "Não foi possível carregar os comentários.", views: "visualizações", membersOnly: "Somente para membros", privateVideo: "Privado", pinnedComment: "Fixado", creatorComment: "Criador" },
  ru: { loadingVideo: "Загрузка видео…", videoLoadError: "Не удалось загрузить это видео.", tryAgain: "Повторить", markUnwatched: "Отметить непросмотренным", like: "Нравится", unlike: "Убрать отметку «Нравится»", scheduleToday: "Запланировать на сегодня", removeSchedule: "Убрать из запланированных", restoreVideo: "Восстановить", descriptionTitle: "Описание", relatedVideos: "Смотреть дальше", commentsTitle: "Комментарии", loadComments: "Загрузить комментарии", loadingComments: "Загрузка комментариев…", commentsEmpty: "Нет комментариев для показа.", commentsLoadError: "Не удалось загрузить комментарии.", views: "просмотров", membersOnly: "Только для участников", privateVideo: "Приватное", pinnedComment: "Закреплён", creatorComment: "Автор" },
  ja: { loadingVideo: "動画を読み込み中…", videoLoadError: "この動画を読み込めませんでした。", tryAgain: "再試行", markUnwatched: "未視聴にする", like: "高評価", unlike: "高評価を取り消す", scheduleToday: "今日の予定に追加", removeSchedule: "予定から削除", restoreVideo: "復元", descriptionTitle: "説明", relatedVideos: "次に見る", commentsTitle: "コメント", loadComments: "コメントを読み込む", loadingComments: "コメントを読み込み中…", commentsEmpty: "表示するコメントはありません。", commentsLoadError: "コメントを読み込めませんでした。", views: "回視聴", membersOnly: "メンバー限定", privateVideo: "非公開", pinnedComment: "固定済み", creatorComment: "投稿者" },
  hu: { loadingVideo: "Videó betöltése…", videoLoadError: "A videó nem tölthető be.", tryAgain: "Újra", markUnwatched: "Megjelölés nem látottként", like: "Kedvelés", unlike: "Kedvelés visszavonása", scheduleToday: "Tervezés mára", removeSchedule: "Eltávolítás a tervezettek közül", restoreVideo: "Visszaállítás", descriptionTitle: "Leírás", relatedVideos: "Következik", commentsTitle: "Hozzászólások", loadComments: "Hozzászólások betöltése", loadingComments: "Hozzászólások betöltése…", commentsEmpty: "Nincs megjeleníthető hozzászólás.", commentsLoadError: "A hozzászólások nem tölthetők be.", views: "megtekintés", membersOnly: "Csak tagoknak", privateVideo: "Privát", pinnedComment: "Kitűzve", creatorComment: "Alkotó" },
};

type VideoActionMessages = {
  videoActions: string;
  goToChannel: string;
  scheduleVideo: string;
  scheduleTonight: string;
  scheduleTomorrow: string;
  scheduleTomorrowEvening: string;
  scheduleWeekend: string;
  addToPlaylist: string;
  downloadVideo: string;
  cancelDownload: string;
  loadingPlaylists: string;
  playlistsEmpty: string;
  savingAction: string;
  removeFromHistory: string;
};

const videoActionMessages: Record<Language, VideoActionMessages> = {
  en: { videoActions: "Video actions", goToChannel: "Go to channel", scheduleVideo: "Plan video", scheduleTonight: "Plan for tonight", scheduleTomorrow: "Plan for tomorrow", scheduleTomorrowEvening: "Plan for tomorrow evening", scheduleWeekend: "Plan for the weekend", addToPlaylist: "Add to playlist", downloadVideo: "Download", cancelDownload: "Cancel download", loadingPlaylists: "Loading playlists…", playlistsEmpty: "You do not have any personal playlists yet.", savingAction: "Saving action…", removeFromHistory: "Remove from history" },
  pl: { videoActions: "Akcje filmu", goToChannel: "Przejdź na kanał", scheduleVideo: "Zaplanuj film", scheduleTonight: "Zaplanuj na wieczór", scheduleTomorrow: "Zaplanuj na jutro", scheduleTomorrowEvening: "Zaplanuj na jutro wieczorem", scheduleWeekend: "Zaplanuj na weekend", addToPlaylist: "Dodaj do playlisty", downloadVideo: "Pobierz", cancelDownload: "Anuluj pobieranie", loadingPlaylists: "Ładowanie playlist…", playlistsEmpty: "Nie masz jeszcze żadnych osobistych playlist.", savingAction: "Zapisywanie działania…", removeFromHistory: "Usuń z historii" },
  de: { videoActions: "Videoaktionen", goToChannel: "Zum Kanal", scheduleVideo: "Video planen", scheduleTonight: "Für heute Abend planen", scheduleTomorrow: "Für morgen planen", scheduleTomorrowEvening: "Für morgen Abend planen", scheduleWeekend: "Für das Wochenende planen", addToPlaylist: "Zur Playlist hinzufügen", downloadVideo: "Herunterladen", cancelDownload: "Download abbrechen", loadingPlaylists: "Playlists werden geladen…", playlistsEmpty: "Du hast noch keine persönlichen Playlists.", savingAction: "Aktion wird gespeichert…", removeFromHistory: "Aus dem Verlauf entfernen" },
  fr: { videoActions: "Actions de la vidéo", goToChannel: "Accéder à la chaîne", scheduleVideo: "Planifier la vidéo", scheduleTonight: "Planifier pour ce soir", scheduleTomorrow: "Planifier pour demain", scheduleTomorrowEvening: "Planifier pour demain soir", scheduleWeekend: "Planifier pour le week-end", addToPlaylist: "Ajouter à une playlist", downloadVideo: "Télécharger", cancelDownload: "Annuler le téléchargement", loadingPlaylists: "Chargement des playlists…", playlistsEmpty: "Vous n’avez pas encore de playlist personnelle.", savingAction: "Enregistrement de l’action…", removeFromHistory: "Supprimer de l’historique" },
  es: { videoActions: "Acciones del vídeo", goToChannel: "Ir al canal", scheduleVideo: "Programar vídeo", scheduleTonight: "Programar para esta noche", scheduleTomorrow: "Programar para mañana", scheduleTomorrowEvening: "Programar para mañana por la noche", scheduleWeekend: "Programar para el fin de semana", addToPlaylist: "Añadir a una lista", downloadVideo: "Descargar", cancelDownload: "Cancelar descarga", loadingPlaylists: "Cargando listas…", playlistsEmpty: "Aún no tienes listas personales.", savingAction: "Guardando acción…", removeFromHistory: "Quitar del historial" },
  "pt-BR": { videoActions: "Ações do vídeo", goToChannel: "Ir para o canal", scheduleVideo: "Planejar vídeo", scheduleTonight: "Planejar para hoje à noite", scheduleTomorrow: "Planejar para amanhã", scheduleTomorrowEvening: "Planejar para amanhã à noite", scheduleWeekend: "Planejar para o fim de semana", addToPlaylist: "Adicionar à playlist", downloadVideo: "Baixar", cancelDownload: "Cancelar download", loadingPlaylists: "Carregando playlists…", playlistsEmpty: "Você ainda não tem playlists pessoais.", savingAction: "Salvando ação…", removeFromHistory: "Remover do histórico" },
  ru: { videoActions: "Действия с видео", goToChannel: "Перейти на канал", scheduleVideo: "Запланировать видео", scheduleTonight: "Запланировать на вечер", scheduleTomorrow: "Запланировать на завтра", scheduleTomorrowEvening: "Запланировать на завтра вечером", scheduleWeekend: "Запланировать на выходные", addToPlaylist: "Добавить в плейлист", downloadVideo: "Скачать", cancelDownload: "Отменить загрузку", loadingPlaylists: "Загрузка плейлистов…", playlistsEmpty: "У вас пока нет личных плейлистов.", savingAction: "Сохранение действия…", removeFromHistory: "Удалить из истории" },
  ja: { videoActions: "動画の操作", goToChannel: "チャンネルを開く", scheduleVideo: "動画を予定に追加", scheduleTonight: "今夜の予定に追加", scheduleTomorrow: "明日の予定に追加", scheduleTomorrowEvening: "明日の夜の予定に追加", scheduleWeekend: "週末の予定に追加", addToPlaylist: "再生リストに追加", downloadVideo: "ダウンロード", cancelDownload: "ダウンロードをキャンセル", loadingPlaylists: "再生リストを読み込み中…", playlistsEmpty: "個人用の再生リストはまだありません。", savingAction: "操作を保存中…", removeFromHistory: "履歴から削除" },
  hu: { videoActions: "Videóműveletek", goToChannel: "Ugrás a csatornára", scheduleVideo: "Videó tervezése", scheduleTonight: "Tervezés ma estére", scheduleTomorrow: "Tervezés holnapra", scheduleTomorrowEvening: "Tervezés holnap estére", scheduleWeekend: "Tervezés hétvégére", addToPlaylist: "Hozzáadás lejátszási listához", downloadVideo: "Letöltés", cancelDownload: "Letöltés megszakítása", loadingPlaylists: "Lejátszási listák betöltése…", playlistsEmpty: "Még nincs személyes lejátszási listád.", savingAction: "Művelet mentése…", removeFromHistory: "Eltávolítás az előzményekből" },
};

const en = {
  ...discoveryMessages.en,
  ...phoneMessages.en,
    ...libraryMessages.en,
    ...emptyMessages.en,
    ...searchMessages.en,
    ...queueMessages.en,
  ...deviceSettingsMessages.en,
    ...systemProfileMessages.en,
  ...navigationMessages.en,
  ...profileMessages.en,
  ...bookmarkMessages.en,
  ...channelMessages.en,
  ...watchMessages.en,
    ...playbackMessages.en,
  ...videoActionMessages.en,
  booting: "Starting YT Zero…",
  instanceTitle: "Connect to YT Zero",
  instanceDescription: "Enter the address of your YT Zero instance. This is saved only on this television.",
  addressLabel: "Instance address",
  addressHint: "For example: https://video.example.com or http://192.168.1.20:3001",
  connect: "Connect",
  connecting: "Connecting…",
  invalidAddress: "Enter a valid HTTP or HTTPS address without a path.",
  cannotConnect: "YT Zero could not be reached at this address.",
  cleartextTitle: "Local connection",
  cleartextHint: "HTTP does not encrypt the connection. Use it only on a trusted home network; HTTPS is recommended.",
  pairTitle: "Pair this television",
  pairDescription: "Scan the QR code with a signed-in device, or open the address and enter the code.",
  enterCode: "Enter this code",
  waiting: "Waiting for approval…",
  pairExpired: "The pairing code expired.",
  retry: "Create a new code",
  changeInstance: "Change instance",
  feedTitle: "Your feed",
  published: "Published",
  arrival: "Added",
  inboxOnly: "Unwatched",
  allVideos: "Show all",
  clearFilters: "Clear filters",
  continueWatching: "Continue watching",
  watchedChannels: "Most watched channels",
  liveBadge: "LIVE",
  loadingFeed: "Loading your feed…",
  loadMore: "Load more",
  refresh: "Refresh",
  emptyFeed: "Nothing to watch",
  emptyFeedHint: "You are caught up, or the current filters hide every video.",
  loadError: "The feed could not be loaded.",
  settings: "Device",
  signOut: "Sign out",
  back: "Back", close: "Close",
  markWatched: "Mark watched",
  reject: "Reject",
  actionFailed: "The action could not be saved.",
  feedPrototype: "This first build covers pairing and feed management. Native playback is the next milestone.",
  noDescription: "No description.",
};

type Messages = { [Key in keyof typeof en]: string };
export type TranslationKey = keyof Messages;
export type Translate = (key: TranslationKey) => string;

const messages: Record<Language, Messages> = {
  en,
  pl: {
    ...deviceSettingsMessages.pl,
    ...systemProfileMessages.pl,
    ...discoveryMessages.pl,
    ...phoneMessages.pl,
    ...libraryMessages.pl,
    ...emptyMessages.pl,
    ...searchMessages.pl,
    ...queueMessages.pl,
    ...navigationMessages.pl,
    ...profileMessages.pl,
    ...bookmarkMessages.pl,
    ...channelMessages.pl,
    ...watchMessages.pl,
    ...playbackMessages.pl,
    ...videoActionMessages.pl,
    booting: "Uruchamianie YT Zero…",
    instanceTitle: "Połącz z YT Zero",
    instanceDescription: "Podaj adres swojej instancji YT Zero. Zostanie zapisany tylko na tym telewizorze.",
    addressLabel: "Adres instancji",
    addressHint: "Na przykład: https://video.example.com albo http://192.168.1.20:3001",
    connect: "Połącz",
    connecting: "Łączenie…",
    invalidAddress: "Podaj poprawny adres HTTP lub HTTPS bez dodatkowej ścieżki.",
    cannotConnect: "Nie udało się połączyć z YT Zero pod tym adresem.",
    cleartextTitle: "Połączenie lokalne",
    cleartextHint: "HTTP nie szyfruje połączenia. Używaj go tylko w zaufanej sieci domowej; zalecany jest HTTPS.",
    pairTitle: "Połącz ten telewizor",
    pairDescription: "Zeskanuj kod QR na zalogowanym urządzeniu albo otwórz podany adres i wpisz kod.",
    enterCode: "Wpisz ten kod",
    waiting: "Oczekiwanie na zatwierdzenie…",
    pairExpired: "Kod parowania wygasł.",
    retry: "Utwórz nowy kod",
    changeInstance: "Zmień instancję",
    feedTitle: "Twój feed",
    published: "Opublikowane",
    arrival: "Dodane",
    inboxOnly: "Nieobejrzane",
    allVideos: "Pokaż wszystkie",
    clearFilters: "Wyczyść filtry",
    continueWatching: "Kontynuuj oglądanie",
    watchedChannels: "Najczęściej oglądane kanały",
    liveBadge: "NA ŻYWO",
    loadingFeed: "Ładowanie feedu…",
    loadMore: "Wczytaj więcej",
    refresh: "Odśwież",
    emptyFeed: "Nie ma nic do obejrzenia",
    emptyFeedHint: "Wszystko nadrobione albo bieżące filtry ukrywają wszystkie filmy.",
    loadError: "Nie udało się wczytać feedu.",
    settings: "Urządzenie",
    signOut: "Wyloguj",
    back: "Wróć", close: "Zamknij",
    markWatched: "Oznacz obejrzane",
    reject: "Odrzuć",
    actionFailed: "Nie udało się zapisać działania.",
    feedPrototype: "Pierwsza wersja obejmuje parowanie i obsługę feedu. Natywny odtwarzacz jest kolejnym etapem.",
    noDescription: "Brak opisu.",
  },
  de: {
    ...deviceSettingsMessages.de,
    ...systemProfileMessages.de,
    ...discoveryMessages.de,
    ...phoneMessages.de,
    ...libraryMessages.de,
    ...emptyMessages.de,
    ...searchMessages.de,
    ...queueMessages.de,
    ...navigationMessages.de,
    ...profileMessages.de,
    ...bookmarkMessages.de,
    ...channelMessages.de,
    ...watchMessages.de,
    ...playbackMessages.de,
    ...videoActionMessages.de,
    loadMore: "Mehr laden", refresh: "Aktualisieren",
    booting: "YT Zero wird gestartet…", instanceTitle: "Mit YT Zero verbinden", instanceDescription: "Gib die Adresse deiner YT-Zero-Instanz ein. Sie wird nur auf diesem Fernseher gespeichert.", addressLabel: "Instanzadresse", addressHint: "Zum Beispiel: https://video.example.com oder http://192.168.1.20:3001", connect: "Verbinden", connecting: "Verbindung wird hergestellt…", invalidAddress: "Gib eine gültige HTTP- oder HTTPS-Adresse ohne Pfad ein.", cannotConnect: "YT Zero ist unter dieser Adresse nicht erreichbar.", cleartextTitle: "Lokale Verbindung", cleartextHint: "HTTP verschlüsselt die Verbindung nicht. Verwende es nur in einem vertrauenswürdigen Heimnetz; HTTPS wird empfohlen.", pairTitle: "Diesen Fernseher verbinden", pairDescription: "Scanne den QR-Code mit einem angemeldeten Gerät oder öffne die Adresse und gib den Code ein.", enterCode: "Diesen Code eingeben", waiting: "Warten auf Bestätigung…", pairExpired: "Der Verbindungscode ist abgelaufen.", retry: "Neuen Code erstellen", changeInstance: "Instanz wechseln", feedTitle: "Dein Feed", published: "Veröffentlicht", arrival: "Hinzugefügt", inboxOnly: "Ungesehen", allVideos: "Alle anzeigen", clearFilters: "Filter zurücksetzen", continueWatching: "Weiterschauen", watchedChannels: "Meistgesehene Kanäle", liveBadge: "LIVE", loadingFeed: "Feed wird geladen…", emptyFeed: "Nichts zu sehen", emptyFeedHint: "Du bist auf dem neuesten Stand oder die Filter blenden alle Videos aus.", loadError: "Der Feed konnte nicht geladen werden.", settings: "Gerät", signOut: "Abmelden", back: "Zurück", close: "Schließen", markWatched: "Als gesehen markieren", reject: "Ablehnen", actionFailed: "Die Aktion konnte nicht gespeichert werden.", feedPrototype: "Diese erste Version umfasst Kopplung und Feed-Verwaltung. Native Wiedergabe ist der nächste Meilenstein.", noDescription: "Keine Beschreibung.",
  },
  fr: {
    ...deviceSettingsMessages.fr,
    ...systemProfileMessages.fr,
    ...discoveryMessages.fr,
    ...phoneMessages.fr,
    ...libraryMessages.fr,
    ...emptyMessages.fr,
    ...searchMessages.fr,
    ...queueMessages.fr,
    ...navigationMessages.fr,
    ...profileMessages.fr,
    ...bookmarkMessages.fr,
    ...channelMessages.fr,
    ...watchMessages.fr,
    ...playbackMessages.fr,
    ...videoActionMessages.fr,
    loadMore: "Charger plus", refresh: "Actualiser",
    booting: "Démarrage de YT Zero…", instanceTitle: "Se connecter à YT Zero", instanceDescription: "Saisissez l’adresse de votre instance YT Zero. Elle est enregistrée uniquement sur ce téléviseur.", addressLabel: "Adresse de l’instance", addressHint: "Par exemple : https://video.example.com ou http://192.168.1.20:3001", connect: "Se connecter", connecting: "Connexion…", invalidAddress: "Saisissez une adresse HTTP ou HTTPS valide sans chemin.", cannotConnect: "YT Zero est inaccessible à cette adresse.", cleartextTitle: "Connexion locale", cleartextHint: "HTTP ne chiffre pas la connexion. Utilisez-le uniquement sur un réseau domestique fiable ; HTTPS est recommandé.", pairTitle: "Associer ce téléviseur", pairDescription: "Scannez le code QR avec un appareil connecté, ou ouvrez l’adresse et saisissez le code.", enterCode: "Saisissez ce code", waiting: "En attente de l’autorisation…", pairExpired: "Le code d’association a expiré.", retry: "Créer un nouveau code", changeInstance: "Changer d’instance", feedTitle: "Votre fil", published: "Publication", arrival: "Ajout", inboxOnly: "Non regardées", allVideos: "Tout afficher", clearFilters: "Effacer les filtres", continueWatching: "Continuer à regarder", watchedChannels: "Chaînes les plus regardées", liveBadge: "EN DIRECT", loadingFeed: "Chargement du fil…", emptyFeed: "Rien à regarder", emptyFeedHint: "Vous êtes à jour ou les filtres masquent toutes les vidéos.", loadError: "Impossible de charger le fil.", settings: "Appareil", signOut: "Se déconnecter", back: "Retour", close: "Fermer", markWatched: "Marquer comme regardée", reject: "Rejeter", actionFailed: "Impossible d’enregistrer l’action.", feedPrototype: "Cette première version couvre l’association et la gestion du fil. La lecture native est la prochaine étape.", noDescription: "Aucune description.",
  },
  es: {
    ...deviceSettingsMessages.es,
    ...systemProfileMessages.es,
    ...discoveryMessages.es,
    ...phoneMessages.es,
    ...libraryMessages.es,
    ...emptyMessages.es,
    ...searchMessages.es,
    ...queueMessages.es,
    ...navigationMessages.es,
    ...profileMessages.es,
    ...bookmarkMessages.es,
    ...channelMessages.es,
    ...watchMessages.es,
    ...playbackMessages.es,
    ...videoActionMessages.es,
    loadMore: "Cargar más", refresh: "Actualizar",
    booting: "Iniciando YT Zero…", instanceTitle: "Conectar con YT Zero", instanceDescription: "Introduce la dirección de tu instancia de YT Zero. Solo se guardará en este televisor.", addressLabel: "Dirección de la instancia", addressHint: "Por ejemplo: https://video.example.com o http://192.168.1.20:3001", connect: "Conectar", connecting: "Conectando…", invalidAddress: "Introduce una dirección HTTP o HTTPS válida sin ruta.", cannotConnect: "No se ha podido acceder a YT Zero en esta dirección.", cleartextTitle: "Conexión local", cleartextHint: "HTTP no cifra la conexión. Úsalo solo en una red doméstica de confianza; se recomienda HTTPS.", pairTitle: "Vincular este televisor", pairDescription: "Escanea el código QR con un dispositivo que tenga la sesión iniciada, o abre la dirección e introduce el código.", enterCode: "Introduce este código", waiting: "Esperando autorización…", pairExpired: "El código de vinculación ha caducado.", retry: "Crear un código nuevo", changeInstance: "Cambiar instancia", feedTitle: "Tu feed", published: "Publicación", arrival: "Añadido", inboxOnly: "Sin ver", allVideos: "Mostrar todo", clearFilters: "Borrar filtros", continueWatching: "Seguir viendo", watchedChannels: "Canales más vistos", liveBadge: "EN DIRECTO", loadingFeed: "Cargando el feed…", emptyFeed: "Nada que ver", emptyFeedHint: "Estás al día o los filtros ocultan todos los vídeos.", loadError: "No se ha podido cargar el feed.", settings: "Dispositivo", signOut: "Cerrar sesión", back: "Volver", close: "Cerrar", markWatched: "Marcar como visto", reject: "Rechazar", actionFailed: "No se ha podido guardar la acción.", feedPrototype: "Esta primera versión incluye la vinculación y la gestión del feed. La reproducción nativa es el siguiente objetivo.", noDescription: "Sin descripción.",
  },
  "pt-BR": {
    ...deviceSettingsMessages["pt-BR"],
    ...systemProfileMessages["pt-BR"],
    ...discoveryMessages["pt-BR"],
    ...phoneMessages["pt-BR"],
    ...libraryMessages["pt-BR"],
    ...emptyMessages["pt-BR"],
    ...searchMessages["pt-BR"],
    ...queueMessages["pt-BR"],
    ...navigationMessages["pt-BR"],
    ...profileMessages["pt-BR"],
    ...bookmarkMessages["pt-BR"],
    ...channelMessages["pt-BR"],
    ...watchMessages["pt-BR"],
    ...playbackMessages["pt-BR"],
    ...videoActionMessages["pt-BR"],
    loadMore: "Carregar mais", refresh: "Atualizar",
    booting: "Iniciando o YT Zero…", instanceTitle: "Conectar ao YT Zero", instanceDescription: "Digite o endereço da sua instância do YT Zero. Ele será salvo apenas nesta televisão.", addressLabel: "Endereço da instância", addressHint: "Por exemplo: https://video.example.com ou http://192.168.1.20:3001", connect: "Conectar", connecting: "Conectando…", invalidAddress: "Digite um endereço HTTP ou HTTPS válido, sem caminho.", cannotConnect: "Não foi possível acessar o YT Zero neste endereço.", cleartextTitle: "Conexão local", cleartextHint: "HTTP não criptografa a conexão. Use apenas em uma rede doméstica confiável; HTTPS é recomendado.", pairTitle: "Conectar esta TV", pairDescription: "Escaneie o código QR com um dispositivo conectado ou abra o endereço e digite o código.", enterCode: "Digite este código", waiting: "Aguardando autorização…", pairExpired: "O código de conexão expirou.", retry: "Criar novo código", changeInstance: "Alterar instância", feedTitle: "Seu feed", published: "Publicado", arrival: "Adicionado", inboxOnly: "Não assistidos", allVideos: "Mostrar todos", clearFilters: "Limpar filtros", continueWatching: "Continuar assistindo", watchedChannels: "Canais mais assistidos", liveBadge: "AO VIVO", loadingFeed: "Carregando o feed…", emptyFeed: "Nada para assistir", emptyFeedHint: "Você está em dia ou os filtros ocultam todos os vídeos.", loadError: "Não foi possível carregar o feed.", settings: "Dispositivo", signOut: "Sair", back: "Voltar", close: "Fechar", markWatched: "Marcar como assistido", reject: "Rejeitar", actionFailed: "Não foi possível salvar a ação.", feedPrototype: "Esta primeira versão inclui conexão e gerenciamento do feed. A reprodução nativa é o próximo marco.", noDescription: "Sem descrição.",
  },
  ru: {
    ...deviceSettingsMessages.ru,
    ...systemProfileMessages.ru,
    ...discoveryMessages.ru,
    ...phoneMessages.ru,
    ...libraryMessages.ru,
    ...emptyMessages.ru,
    ...searchMessages.ru,
    ...queueMessages.ru,
    ...navigationMessages.ru,
    ...profileMessages.ru,
    ...bookmarkMessages.ru,
    ...channelMessages.ru,
    ...watchMessages.ru,
    ...playbackMessages.ru,
    ...videoActionMessages.ru,
    loadMore: "Загрузить ещё", refresh: "Обновить",
    booting: "Запуск YT Zero…", instanceTitle: "Подключение к YT Zero", instanceDescription: "Введите адрес вашей установки YT Zero. Он будет сохранён только на этом телевизоре.", addressLabel: "Адрес установки", addressHint: "Например: https://video.example.com или http://192.168.1.20:3001", connect: "Подключиться", connecting: "Подключение…", invalidAddress: "Введите корректный адрес HTTP или HTTPS без пути.", cannotConnect: "Не удалось открыть YT Zero по этому адресу.", cleartextTitle: "Локальное подключение", cleartextHint: "HTTP не шифрует соединение. Используйте его только в доверенной домашней сети; рекомендуется HTTPS.", pairTitle: "Подключить телевизор", pairDescription: "Отсканируйте QR-код на устройстве с активным сеансом или откройте адрес и введите код.", enterCode: "Введите этот код", waiting: "Ожидание подтверждения…", pairExpired: "Срок действия кода истёк.", retry: "Создать новый код", changeInstance: "Сменить установку", feedTitle: "Ваша лента", published: "Опубликовано", arrival: "Добавлено", inboxOnly: "Непросмотренные", allVideos: "Показать все", clearFilters: "Сбросить фильтры", continueWatching: "Продолжить просмотр", watchedChannels: "Часто просматриваемые каналы", liveBadge: "В ЭФИРЕ", loadingFeed: "Загрузка ленты…", emptyFeed: "Смотреть нечего", emptyFeedHint: "Вы всё посмотрели или фильтры скрывают все видео.", loadError: "Не удалось загрузить ленту.", settings: "Устройство", signOut: "Выйти", back: "Назад", close: "Закрыть", markWatched: "Отметить просмотренным", reject: "Отклонить", actionFailed: "Не удалось сохранить действие.", feedPrototype: "Первая версия поддерживает подключение и управление лентой. Нативный проигрыватель — следующий этап.", noDescription: "Нет описания.",
  },
  ja: {
    ...deviceSettingsMessages.ja,
    ...systemProfileMessages.ja,
    ...discoveryMessages.ja,
    ...phoneMessages.ja,
    ...libraryMessages.ja,
    ...emptyMessages.ja,
    ...searchMessages.ja,
    ...queueMessages.ja,
    ...navigationMessages.ja,
    ...profileMessages.ja,
    ...bookmarkMessages.ja,
    ...channelMessages.ja,
    ...watchMessages.ja,
    ...playbackMessages.ja,
    ...videoActionMessages.ja,
    loadMore: "さらに読み込む", refresh: "更新",
    booting: "YT Zero を起動中…", instanceTitle: "YT Zero に接続", instanceDescription: "YT Zero インスタンスのアドレスを入力します。このテレビにのみ保存されます。", addressLabel: "インスタンスのアドレス", addressHint: "例: https://video.example.com または http://192.168.1.20:3001", connect: "接続", connecting: "接続中…", invalidAddress: "パスを含まない有効な HTTP または HTTPS アドレスを入力してください。", cannotConnect: "このアドレスの YT Zero に接続できませんでした。", cleartextTitle: "ローカル接続", cleartextHint: "HTTP 接続は暗号化されません。信頼できるホームネットワークでのみ使用し、通常は HTTPS を推奨します。", pairTitle: "このテレビを接続", pairDescription: "ログイン済みの端末で QR コードを読み取るか、アドレスを開いてコードを入力します。", enterCode: "このコードを入力", waiting: "許可を待っています…", pairExpired: "接続コードの期限が切れました。", retry: "新しいコードを作成", changeInstance: "インスタンスを変更", feedTitle: "フィード", published: "公開日", arrival: "追加日", inboxOnly: "未視聴", allVideos: "すべて表示", clearFilters: "フィルターをクリア", continueWatching: "続きを見る", watchedChannels: "よく見るチャンネル", liveBadge: "ライブ", loadingFeed: "フィードを読み込み中…", emptyFeed: "視聴する動画はありません", emptyFeedHint: "すべて視聴済みか、フィルターですべての動画が非表示です。", loadError: "フィードを読み込めませんでした。", settings: "デバイス", signOut: "ログアウト", back: "戻る", close: "閉じる", markWatched: "視聴済みにする", reject: "除外", actionFailed: "操作を保存できませんでした。", feedPrototype: "最初のバージョンは接続とフィード管理に対応しています。ネイティブ再生は次のマイルストーンです。", noDescription: "説明はありません。",
  },
  hu: {
    ...deviceSettingsMessages.hu,
    ...systemProfileMessages.hu,
    ...discoveryMessages.hu,
    ...phoneMessages.hu,
    ...libraryMessages.hu,
    ...emptyMessages.hu,
    ...searchMessages.hu,
    ...queueMessages.hu,
    ...navigationMessages.hu,
    ...profileMessages.hu,
    ...bookmarkMessages.hu,
    ...channelMessages.hu,
    ...watchMessages.hu,
    ...playbackMessages.hu,
    ...videoActionMessages.hu,
    loadMore: "Továbbiak betöltése", refresh: "Frissítés",
    booting: "A YT Zero indítása…", instanceTitle: "Csatlakozás a YT Zerohoz", instanceDescription: "Add meg a YT Zero-példány címét. A cím csak ezen a televízión lesz tárolva.", addressLabel: "Példány címe", addressHint: "Például: https://video.example.com vagy http://192.168.1.20:3001", connect: "Csatlakozás", connecting: "Csatlakozás…", invalidAddress: "Adj meg egy érvényes HTTP- vagy HTTPS-címet elérési út nélkül.", cannotConnect: "A YT Zero nem érhető el ezen a címen.", cleartextTitle: "Helyi kapcsolat", cleartextHint: "A HTTP nem titkosítja a kapcsolatot. Csak megbízható otthoni hálózaton használd; a HTTPS ajánlott.", pairTitle: "Televízió párosítása", pairDescription: "Olvasd be a QR-kódot egy bejelentkezett eszközzel, vagy nyisd meg a címet, és írd be a kódot.", enterCode: "Írd be ezt a kódot", waiting: "Várakozás az engedélyezésre…", pairExpired: "A párosítási kód lejárt.", retry: "Új kód létrehozása", changeInstance: "Példány váltása", feedTitle: "Saját hírfolyam", published: "Közzétéve", arrival: "Hozzáadva", inboxOnly: "Nem látott", allVideos: "Összes megjelenítése", clearFilters: "Szűrők törlése", continueWatching: "Folytatás", watchedChannels: "Leggyakrabban nézett csatornák", liveBadge: "ÉLŐ", loadingFeed: "Hírfolyam betöltése…", emptyFeed: "Nincs mit megnézni", emptyFeedHint: "Mindent megnéztél, vagy a szűrők elrejtik az összes videót.", loadError: "A hírfolyam nem tölthető be.", settings: "Eszköz", signOut: "Kijelentkezés", back: "Vissza", close: "Bezárás", markWatched: "Megnézettnek jelölés", reject: "Elutasítás", actionFailed: "A művelet nem menthető.", feedPrototype: "Az első verzió a párosítást és a hírfolyam kezelését tartalmazza. A natív lejátszás a következő mérföldkő.", noDescription: "Nincs leírás.",
  },
};

const supported = new Set<Language>(["en", "pl", "de", "fr", "es", "pt-BR", "ru", "ja", "hu"]);

export function deviceLanguage(): Language {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  if (locale.toLowerCase().startsWith("pt-br")) return "pt-BR";
  const base = locale.split("-")[0] as Language;
  return supported.has(base) ? base : "en";
}

export function normalizeLanguage(value: unknown): Language {
  return typeof value === "string" && supported.has(value as Language) ? value as Language : "en";
}

export function translator(language: Language): Translate {
  return (key: keyof Messages): string => messages[language][key];
}

export const localeTags: Record<Language, string> = {
  en: "en-US", pl: "pl-PL", de: "de-DE", fr: "fr-FR", es: "es-ES",
  "pt-BR": "pt-BR", ru: "ru-RU", ja: "ja-JP", hu: "hu-HU",
};
