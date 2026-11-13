import type { Language } from "../types";

type Messages = {
  /** The avatar menu row that switches between the two modes, and its hint. */
  musicSwitchToMusic: string; musicSwitchToVideo: string; musicSwitchHint: string;
  musicTitle: string; musicHome: string; musicSearch: string; musicLibrary: string;
  /** Home's two stations. */
  musicYourMix: string; musicYourMixHint: string; musicLikedSongs: string; musicLikedSongsHint: string;
  musicRecent: string; musicSearchHint: string; musicNoResults: string; musicSearchFailed: string;
  musicLoadFailed: string; musicLibraryEmpty: string; musicRecentEmpty: string; musicStartFailed: string; musicStarting: string;
  musicNowPlaying: string; musicUpNext: string; musicPlay: string; musicPause: string; musicNext: string; musicPrevious: string;
  musicLike: string; musicUnlike: string; musicNotThis: string; musicRetry: string;
  /** The sleep timer's "stop when this song ends" choice, and the note when it paused the music. */
  musicSleepEndOfSong: string; musicSleepStopped: string;
};

/** Music mode: its own screens, separate from video. */
export const musicMessages: Record<Language, Messages> = {
  en: {
    musicSwitchToMusic: "Switch to music", musicSwitchToVideo: "Switch to video", musicSwitchHint: "Music keeps its own likes and history",
    musicTitle: "Music", musicHome: "Home", musicSearch: "Search", musicLibrary: "Library",
    musicYourMix: "Your mix", musicYourMixHint: "Songs picked from what you play", musicLikedSongs: "Liked songs", musicLikedSongsHint: "A station from songs you like",
    musicRecent: "Recently played", musicSearchHint: "Search songs and artists", musicNoResults: "No songs found", musicSearchFailed: "Search failed",
    musicLoadFailed: "Couldn't load your music", musicLibraryEmpty: "Songs you like appear here", musicRecentEmpty: "Search for a song to start a station",
    musicStartFailed: "Couldn't start the music", musicStarting: "Starting…",
    musicNowPlaying: "Now playing", musicUpNext: "Up next", musicPlay: "Play", musicPause: "Pause", musicNext: "Next song", musicPrevious: "Previous song",
    musicLike: "Like", musicUnlike: "Remove like", musicNotThis: "Not this one", musicRetry: "Try again",
    musicSleepEndOfSong: "End of song", musicSleepStopped: "Sleep timer paused the music",
  },
  pl: {
    musicSwitchToMusic: "Przełącz na muzykę", musicSwitchToVideo: "Przełącz na filmy", musicSwitchHint: "Muzyka ma osobne polubienia i historię",
    musicTitle: "Muzyka", musicHome: "Główna", musicSearch: "Szukaj", musicLibrary: "Biblioteka",
    musicYourMix: "Twój mix", musicYourMixHint: "Utwory dobrane do tego, czego słuchasz", musicLikedSongs: "Polubione utwory", musicLikedSongsHint: "Stacja z polubionych utworów",
    musicRecent: "Ostatnio odtwarzane", musicSearchHint: "Szukaj utworów i wykonawców", musicNoResults: "Nie znaleziono utworów", musicSearchFailed: "Wyszukiwanie nie powiodło się",
    musicLoadFailed: "Nie udało się wczytać muzyki", musicLibraryEmpty: "Tu pojawią się polubione utwory", musicRecentEmpty: "Wyszukaj utwór, aby uruchomić stację",
    musicStartFailed: "Nie udało się uruchomić muzyki", musicStarting: "Uruchamianie…",
    musicNowPlaying: "Teraz odtwarzane", musicUpNext: "Następne", musicPlay: "Odtwórz", musicPause: "Wstrzymaj", musicNext: "Następny utwór", musicPrevious: "Poprzedni utwór",
    musicLike: "Lubię to", musicUnlike: "Usuń polubienie", musicNotThis: "Nie ten utwór", musicRetry: "Spróbuj ponownie",
    musicSleepEndOfSong: "Koniec utworu", musicSleepStopped: "Wyłącznik czasowy wstrzymał muzykę",
  },
  de: {
    musicSwitchToMusic: "Zu Musik wechseln", musicSwitchToVideo: "Zu Videos wechseln", musicSwitchHint: "Musik hat eigene Likes und einen eigenen Verlauf",
    musicTitle: "Musik", musicHome: "Start", musicSearch: "Suche", musicLibrary: "Mediathek",
    musicYourMix: "Dein Mix", musicYourMixHint: "Songs passend zu dem, was du hörst", musicLikedSongs: "Gelikte Songs", musicLikedSongsHint: "Ein Sender aus Songs, die du magst",
    musicRecent: "Zuletzt gespielt", musicSearchHint: "Songs und Künstler suchen", musicNoResults: "Keine Songs gefunden", musicSearchFailed: "Suche fehlgeschlagen",
    musicLoadFailed: "Deine Musik konnte nicht geladen werden", musicLibraryEmpty: "Songs, die du likst, erscheinen hier", musicRecentEmpty: "Suche einen Song, um einen Sender zu starten",
    musicStartFailed: "Die Musik konnte nicht gestartet werden", musicStarting: "Wird gestartet…",
    musicNowPlaying: "Läuft gerade", musicUpNext: "Als Nächstes", musicPlay: "Abspielen", musicPause: "Pause", musicNext: "Nächster Song", musicPrevious: "Vorheriger Song",
    musicLike: "Mag ich", musicUnlike: "Like entfernen", musicNotThis: "Nicht diesen", musicRetry: "Erneut versuchen",
    musicSleepEndOfSong: "Ende des Songs", musicSleepStopped: "Der Sleep-Timer hat die Musik angehalten",
  },
  fr: {
    musicSwitchToMusic: "Passer à la musique", musicSwitchToVideo: "Passer aux vidéos", musicSwitchHint: "La musique a ses propres j'aime et son historique",
    musicTitle: "Musique", musicHome: "Accueil", musicSearch: "Recherche", musicLibrary: "Bibliothèque",
    musicYourMix: "Votre mix", musicYourMixHint: "Des titres choisis d'après vos écoutes", musicLikedSongs: "Titres aimés", musicLikedSongsHint: "Une station à partir des titres que vous aimez",
    musicRecent: "Écoutés récemment", musicSearchHint: "Rechercher des titres et des artistes", musicNoResults: "Aucun titre trouvé", musicSearchFailed: "La recherche a échoué",
    musicLoadFailed: "Impossible de charger votre musique", musicLibraryEmpty: "Les titres que vous aimez apparaissent ici", musicRecentEmpty: "Recherchez un titre pour lancer une station",
    musicStartFailed: "Impossible de lancer la musique", musicStarting: "Lancement…",
    musicNowPlaying: "En cours de lecture", musicUpNext: "À suivre", musicPlay: "Lecture", musicPause: "Pause", musicNext: "Titre suivant", musicPrevious: "Titre précédent",
    musicLike: "J'aime", musicUnlike: "Retirer le j'aime", musicNotThis: "Pas celui-ci", musicRetry: "Réessayer",
    musicSleepEndOfSong: "Fin du titre", musicSleepStopped: "Le minuteur de veille a mis la musique en pause",
  },
  es: {
    musicSwitchToMusic: "Cambiar a música", musicSwitchToVideo: "Cambiar a vídeos", musicSwitchHint: "La música tiene sus propios me gusta e historial",
    musicTitle: "Música", musicHome: "Inicio", musicSearch: "Buscar", musicLibrary: "Biblioteca",
    musicYourMix: "Tu mix", musicYourMixHint: "Canciones elegidas según lo que escuchas", musicLikedSongs: "Canciones que te gustan", musicLikedSongsHint: "Una emisora con las canciones que te gustan",
    musicRecent: "Escuchado recientemente", musicSearchHint: "Busca canciones y artistas", musicNoResults: "No se encontraron canciones", musicSearchFailed: "La búsqueda ha fallado",
    musicLoadFailed: "No se pudo cargar tu música", musicLibraryEmpty: "Aquí aparecen las canciones que te gustan", musicRecentEmpty: "Busca una canción para iniciar una emisora",
    musicStartFailed: "No se pudo iniciar la música", musicStarting: "Iniciando…",
    musicNowPlaying: "Reproduciendo", musicUpNext: "A continuación", musicPlay: "Reproducir", musicPause: "Pausa", musicNext: "Siguiente canción", musicPrevious: "Canción anterior",
    musicLike: "Me gusta", musicUnlike: "Quitar me gusta", musicNotThis: "Esta no", musicRetry: "Reintentar",
    musicSleepEndOfSong: "Final de la canción", musicSleepStopped: "El temporizador ha pausado la música",
  },
  "pt-BR": {
    musicSwitchToMusic: "Mudar para música", musicSwitchToVideo: "Mudar para vídeos", musicSwitchHint: "A música tem curtidas e histórico próprios",
    musicTitle: "Música", musicHome: "Início", musicSearch: "Buscar", musicLibrary: "Biblioteca",
    musicYourMix: "Seu mix", musicYourMixHint: "Músicas escolhidas pelo que você ouve", musicLikedSongs: "Músicas curtidas", musicLikedSongsHint: "Uma estação com as músicas que você curte",
    musicRecent: "Tocadas recentemente", musicSearchHint: "Buscar músicas e artistas", musicNoResults: "Nenhuma música encontrada", musicSearchFailed: "A busca falhou",
    musicLoadFailed: "Não foi possível carregar suas músicas", musicLibraryEmpty: "As músicas que você curtir aparecem aqui", musicRecentEmpty: "Busque uma música para iniciar uma estação",
    musicStartFailed: "Não foi possível iniciar a música", musicStarting: "Iniciando…",
    musicNowPlaying: "Tocando agora", musicUpNext: "A seguir", musicPlay: "Tocar", musicPause: "Pausar", musicNext: "Próxima música", musicPrevious: "Música anterior",
    musicLike: "Curtir", musicUnlike: "Remover curtida", musicNotThis: "Esta não", musicRetry: "Tentar de novo",
    musicSleepEndOfSong: "Fim da música", musicSleepStopped: "O timer pausou a música",
  },
  ru: {
    musicSwitchToMusic: "Перейти к музыке", musicSwitchToVideo: "Перейти к видео", musicSwitchHint: "У музыки свои лайки и история",
    musicTitle: "Музыка", musicHome: "Главная", musicSearch: "Поиск", musicLibrary: "Библиотека",
    musicYourMix: "Ваш микс", musicYourMixHint: "Треки по вашим прослушиваниям", musicLikedSongs: "Понравившиеся треки", musicLikedSongsHint: "Станция из треков, которые вам нравятся",
    musicRecent: "Недавно прослушанные", musicSearchHint: "Поиск треков и исполнителей", musicNoResults: "Треки не найдены", musicSearchFailed: "Не удалось выполнить поиск",
    musicLoadFailed: "Не удалось загрузить музыку", musicLibraryEmpty: "Здесь появятся понравившиеся треки", musicRecentEmpty: "Найдите трек, чтобы запустить станцию",
    musicStartFailed: "Не удалось включить музыку", musicStarting: "Запуск…",
    musicNowPlaying: "Сейчас играет", musicUpNext: "Далее", musicPlay: "Воспроизвести", musicPause: "Пауза", musicNext: "Следующий трек", musicPrevious: "Предыдущий трек",
    musicLike: "Нравится", musicUnlike: "Убрать лайк", musicNotThis: "Не этот", musicRetry: "Повторить",
    musicSleepEndOfSong: "Конец трека", musicSleepStopped: "Таймер сна приостановил музыку",
  },
  ja: {
    musicSwitchToMusic: "音楽に切り替え", musicSwitchToVideo: "動画に切り替え", musicSwitchHint: "音楽の高評価と履歴は動画とは別です",
    musicTitle: "音楽", musicHome: "ホーム", musicSearch: "検索", musicLibrary: "ライブラリ",
    musicYourMix: "あなたのミックス", musicYourMixHint: "再生した曲に合わせて選曲", musicLikedSongs: "高評価した曲", musicLikedSongsHint: "高評価した曲からのステーション",
    musicRecent: "最近再生した曲", musicSearchHint: "曲とアーティストを検索", musicNoResults: "曲が見つかりません", musicSearchFailed: "検索できませんでした",
    musicLoadFailed: "音楽を読み込めませんでした", musicLibraryEmpty: "高評価した曲がここに表示されます", musicRecentEmpty: "曲を検索してステーションを始めましょう",
    musicStartFailed: "音楽を再生できませんでした", musicStarting: "開始しています…",
    musicNowPlaying: "再生中", musicUpNext: "次の曲", musicPlay: "再生", musicPause: "一時停止", musicNext: "次の曲へ", musicPrevious: "前の曲へ",
    musicLike: "高評価", musicUnlike: "高評価を取り消す", musicNotThis: "この曲は除外", musicRetry: "再試行",
    musicSleepEndOfSong: "曲の終わり", musicSleepStopped: "スリープタイマーで音楽を一時停止しました",
  },
  hu: {
    musicSwitchToMusic: "Váltás zenére", musicSwitchToVideo: "Váltás videókra", musicSwitchHint: "A zenének saját kedvelései és előzményei vannak",
    musicTitle: "Zene", musicHome: "Kezdőlap", musicSearch: "Keresés", musicLibrary: "Könyvtár",
    musicYourMix: "Saját mix", musicYourMixHint: "Dalok aszerint, amit hallgatsz", musicLikedSongs: "Kedvelt dalok", musicLikedSongsHint: "Állomás a kedvelt dalaidból",
    musicRecent: "Nemrég játszott", musicSearchHint: "Dalok és előadók keresése", musicNoResults: "Nincs találat", musicSearchFailed: "A keresés nem sikerült",
    musicLoadFailed: "Nem sikerült betölteni a zenéidet", musicLibraryEmpty: "A kedvelt dalaid itt jelennek meg", musicRecentEmpty: "Keress egy dalt egy állomás indításához",
    musicStartFailed: "Nem sikerült elindítani a zenét", musicStarting: "Indítás…",
    musicNowPlaying: "Most szól", musicUpNext: "Következik", musicPlay: "Lejátszás", musicPause: "Szünet", musicNext: "Következő dal", musicPrevious: "Előző dal",
    musicLike: "Tetszik", musicUnlike: "Kedvelés visszavonása", musicNotThis: "Ezt ne", musicRetry: "Újra",
    musicSleepEndOfSong: "A dal végén", musicSleepStopped: "Az elalváskapcsoló szüneteltette a zenét",
  },
};
