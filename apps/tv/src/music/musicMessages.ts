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
  /** Albums, artists and saved albums. `musicFromAlbum` names the album playing. */
  musicSongs: string; musicAlbums: string; musicArtists: string; musicSingles: string; musicTopSongs: string; musicShuffle: string; musicSave: string; musicSaved: string; musicSavedAlbums: string; musicFromAlbum: string; musicStation: string; musicPlayStation: string; musicAlbumFailed: string; musicArtistFailed: string; musicSingle: string; musicAlbum: string;
  /** Moods & genres: Home's two shelves of YouTube Music categories, and their pages. */
  musicMoods: string; musicGenres: string; musicGenreFailed: string; musicPlaylistFailed: string;
  /** The profile's own playlists and saved YouTube Music ones. `{name}` is a playlist's name. */
  musicYourPlaylists: string; musicSavedPlaylists: string; musicNewPlaylist: string; musicPlaylistName: string; musicCreate: string; musicRenamePlaylist: string; musicDelete: string; musicDeletePlaylist: string; musicDeletePlaylistConfirm: string; musicPlaylistEmpty: string; musicRemoveFromPlaylist: string; musicEditPlaylist: string; musicDoneEditing: string; musicMoveUp: string; musicMoveDown: string; musicAddToPlaylist: string; musicAddedToPlaylist: string; musicAlreadyInPlaylist: string; musicActionFailed: string;
};

/** Music mode: its own screens, separate from video. */
export const musicMessages: Record<Language, Messages> = {
  en: {
    musicSwitchToMusic: "Switch to music", musicSwitchToVideo: "Switch to video", musicSwitchHint: "Music keeps its own likes and history",
    musicTitle: "Music", musicHome: "Home", musicSearch: "Search", musicLibrary: "Library",
    musicYourMix: "Your mix", musicYourMixHint: "Songs picked from what you play", musicLikedSongs: "Liked songs", musicLikedSongsHint: "A station from songs you like",
    musicRecent: "Recently played", musicSearchHint: "Search songs, albums and artists", musicNoResults: "Nothing found", musicSearchFailed: "Search failed",
    musicLoadFailed: "Couldn't load your music", musicLibraryEmpty: "Albums you save and songs you like appear here", musicRecentEmpty: "Search for a song to start a station",
    musicStartFailed: "Couldn't start the music", musicStarting: "Starting…",
    musicNowPlaying: "Now playing", musicUpNext: "Up next", musicPlay: "Play", musicPause: "Pause", musicNext: "Next song", musicPrevious: "Previous song",
    musicLike: "Like", musicUnlike: "Remove like", musicNotThis: "Not this one", musicRetry: "Try again",
    musicSleepEndOfSong: "End of song", musicSleepStopped: "Sleep timer paused the music",
    musicSongs: "Songs", musicAlbums: "Albums", musicArtists: "Artists", musicSingles: "Singles & EPs", musicTopSongs: "Top songs", musicShuffle: "Shuffle", musicSave: "Save", musicSaved: "Saved", musicSavedAlbums: "Saved albums", musicFromAlbum: "From {title}", musicStation: "Station", musicPlayStation: "Play station", musicAlbumFailed: "Couldn't load this album", musicArtistFailed: "Couldn't load this artist", musicSingle: "Single", musicAlbum: "Album",
    musicMoods: "Moods & moments", musicGenres: "Genres", musicGenreFailed: "Couldn't load this genre", musicPlaylistFailed: "Couldn't load this playlist",
    musicYourPlaylists: "Your playlists", musicSavedPlaylists: "Saved playlists", musicNewPlaylist: "New playlist", musicPlaylistName: "Playlist name", musicCreate: "Create", musicRenamePlaylist: "Rename", musicDelete: "Delete", musicDeletePlaylist: "Delete playlist", musicDeletePlaylistConfirm: "Delete “{name}”? Only the playlist goes; its songs aren't removed from anywhere else.", musicPlaylistEmpty: "No songs yet. Add songs with Add to playlist.", musicRemoveFromPlaylist: "Remove from playlist", musicEditPlaylist: "Edit", musicDoneEditing: "Done", musicMoveUp: "Move up", musicMoveDown: "Move down", musicAddToPlaylist: "Add to playlist", musicAddedToPlaylist: "Added to {name}", musicAlreadyInPlaylist: "Already in {name}", musicActionFailed: "Something went wrong. Try again.",
  },
  pl: {
    musicSwitchToMusic: "Przełącz na muzykę", musicSwitchToVideo: "Przełącz na filmy", musicSwitchHint: "Muzyka ma osobne polubienia i historię",
    musicTitle: "Muzyka", musicHome: "Główna", musicSearch: "Szukaj", musicLibrary: "Biblioteka",
    musicYourMix: "Twój mix", musicYourMixHint: "Utwory dobrane do tego, czego słuchasz", musicLikedSongs: "Polubione utwory", musicLikedSongsHint: "Stacja z polubionych utworów",
    musicRecent: "Ostatnio odtwarzane", musicSearchHint: "Szukaj utworów, albumów i wykonawców", musicNoResults: "Nic nie znaleziono", musicSearchFailed: "Wyszukiwanie nie powiodło się",
    musicLoadFailed: "Nie udało się wczytać muzyki", musicLibraryEmpty: "Tu pojawią się zapisane albumy i polubione utwory", musicRecentEmpty: "Wyszukaj utwór, aby uruchomić stację",
    musicStartFailed: "Nie udało się uruchomić muzyki", musicStarting: "Uruchamianie…",
    musicNowPlaying: "Teraz odtwarzane", musicUpNext: "Następne", musicPlay: "Odtwórz", musicPause: "Wstrzymaj", musicNext: "Następny utwór", musicPrevious: "Poprzedni utwór",
    musicLike: "Lubię to", musicUnlike: "Usuń polubienie", musicNotThis: "Nie ten utwór", musicRetry: "Spróbuj ponownie",
    musicSleepEndOfSong: "Koniec utworu", musicSleepStopped: "Wyłącznik czasowy wstrzymał muzykę",
    musicSongs: "Utwory", musicAlbums: "Albumy", musicArtists: "Wykonawcy", musicSingles: "Single i EP", musicTopSongs: "Popularne utwory", musicShuffle: "Losowo", musicSave: "Zapisz", musicSaved: "Zapisano", musicSavedAlbums: "Zapisane albumy", musicFromAlbum: "Z albumu {title}", musicStation: "Stacja", musicPlayStation: "Uruchom stację", musicAlbumFailed: "Nie udało się wczytać albumu", musicArtistFailed: "Nie udało się wczytać wykonawcy", musicSingle: "Singiel", musicAlbum: "Album",
    musicMoods: "Nastroje i chwile", musicGenres: "Gatunki", musicGenreFailed: "Nie udało się wczytać gatunku", musicPlaylistFailed: "Nie udało się wczytać playlisty",
    musicYourPlaylists: "Twoje playlisty", musicSavedPlaylists: "Zapisane playlisty", musicNewPlaylist: "Nowa playlista", musicPlaylistName: "Nazwa playlisty", musicCreate: "Utwórz", musicRenamePlaylist: "Zmień nazwę", musicDelete: "Usuń", musicDeletePlaylist: "Usuń playlistę", musicDeletePlaylistConfirm: "Usunąć „{name}”? Utwory zostaną tam, gdzie są poza nią.", musicPlaylistEmpty: "Brak utworów. Dodaj je opcją Dodaj do playlisty.", musicRemoveFromPlaylist: "Usuń z playlisty", musicEditPlaylist: "Edytuj", musicDoneEditing: "Gotowe", musicMoveUp: "Przesuń w górę", musicMoveDown: "Przesuń w dół", musicAddToPlaylist: "Dodaj do playlisty", musicAddedToPlaylist: "Dodano do: {name}", musicAlreadyInPlaylist: "Już jest w: {name}", musicActionFailed: "Coś poszło nie tak. Spróbuj ponownie.",
  },
  de: {
    musicSwitchToMusic: "Zu Musik wechseln", musicSwitchToVideo: "Zu Videos wechseln", musicSwitchHint: "Musik hat eigene Likes und einen eigenen Verlauf",
    musicTitle: "Musik", musicHome: "Start", musicSearch: "Suche", musicLibrary: "Mediathek",
    musicYourMix: "Dein Mix", musicYourMixHint: "Songs passend zu dem, was du hörst", musicLikedSongs: "Gelikte Songs", musicLikedSongsHint: "Ein Sender aus Songs, die du magst",
    musicRecent: "Zuletzt gespielt", musicSearchHint: "Songs, Alben und Künstler suchen", musicNoResults: "Nichts gefunden", musicSearchFailed: "Suche fehlgeschlagen",
    musicLoadFailed: "Deine Musik konnte nicht geladen werden", musicLibraryEmpty: "Gespeicherte Alben und Songs, die du likst, erscheinen hier", musicRecentEmpty: "Suche einen Song, um einen Sender zu starten",
    musicStartFailed: "Die Musik konnte nicht gestartet werden", musicStarting: "Wird gestartet…",
    musicNowPlaying: "Läuft gerade", musicUpNext: "Als Nächstes", musicPlay: "Abspielen", musicPause: "Pause", musicNext: "Nächster Song", musicPrevious: "Vorheriger Song",
    musicLike: "Mag ich", musicUnlike: "Like entfernen", musicNotThis: "Nicht diesen", musicRetry: "Erneut versuchen",
    musicSleepEndOfSong: "Ende des Songs", musicSleepStopped: "Der Sleep-Timer hat die Musik angehalten",
    musicSongs: "Songs", musicAlbums: "Alben", musicArtists: "Künstler", musicSingles: "Singles & EPs", musicTopSongs: "Top-Songs", musicShuffle: "Zufallswiedergabe", musicSave: "Speichern", musicSaved: "Gespeichert", musicSavedAlbums: "Gespeicherte Alben", musicFromAlbum: "Aus {title}", musicStation: "Sender", musicPlayStation: "Sender starten", musicAlbumFailed: "Album konnte nicht geladen werden", musicArtistFailed: "Künstler konnte nicht geladen werden", musicSingle: "Single", musicAlbum: "Album",
    musicMoods: "Stimmungen & Momente", musicGenres: "Genres", musicGenreFailed: "Genre konnte nicht geladen werden", musicPlaylistFailed: "Playlist konnte nicht geladen werden",
    musicYourPlaylists: "Deine Playlists", musicSavedPlaylists: "Gespeicherte Playlists", musicNewPlaylist: "Neue Playlist", musicPlaylistName: "Playlist-Name", musicCreate: "Erstellen", musicRenamePlaylist: "Umbenennen", musicDelete: "Löschen", musicDeletePlaylist: "Playlist löschen", musicDeletePlaylistConfirm: "„{name}“ löschen? Die Songs bleiben überall sonst erhalten.", musicPlaylistEmpty: "Noch keine Songs. Füge sie mit „Zur Playlist hinzufügen“ hinzu.", musicRemoveFromPlaylist: "Aus Playlist entfernen", musicEditPlaylist: "Bearbeiten", musicDoneEditing: "Fertig", musicMoveUp: "Nach oben", musicMoveDown: "Nach unten", musicAddToPlaylist: "Zur Playlist hinzufügen", musicAddedToPlaylist: "Zu {name} hinzugefügt", musicAlreadyInPlaylist: "Bereits in {name}", musicActionFailed: "Etwas ist schiefgelaufen. Versuche es erneut.",
  },
  fr: {
    musicSwitchToMusic: "Passer à la musique", musicSwitchToVideo: "Passer aux vidéos", musicSwitchHint: "La musique a ses propres j'aime et son historique",
    musicTitle: "Musique", musicHome: "Accueil", musicSearch: "Recherche", musicLibrary: "Bibliothèque",
    musicYourMix: "Votre mix", musicYourMixHint: "Des titres choisis d'après vos écoutes", musicLikedSongs: "Titres aimés", musicLikedSongsHint: "Une station à partir des titres que vous aimez",
    musicRecent: "Écoutés récemment", musicSearchHint: "Rechercher des titres, albums et artistes", musicNoResults: "Aucun résultat", musicSearchFailed: "La recherche a échoué",
    musicLoadFailed: "Impossible de charger votre musique", musicLibraryEmpty: "Les albums enregistrés et les titres que vous aimez apparaissent ici", musicRecentEmpty: "Recherchez un titre pour lancer une station",
    musicStartFailed: "Impossible de lancer la musique", musicStarting: "Lancement…",
    musicNowPlaying: "En cours de lecture", musicUpNext: "À suivre", musicPlay: "Lecture", musicPause: "Pause", musicNext: "Titre suivant", musicPrevious: "Titre précédent",
    musicLike: "J'aime", musicUnlike: "Retirer le j'aime", musicNotThis: "Pas celui-ci", musicRetry: "Réessayer",
    musicSleepEndOfSong: "Fin du titre", musicSleepStopped: "Le minuteur de veille a mis la musique en pause",
    musicSongs: "Titres", musicAlbums: "Albums", musicArtists: "Artistes", musicSingles: "Singles et EP", musicTopSongs: "Titres populaires", musicShuffle: "Lecture aléatoire", musicSave: "Enregistrer", musicSaved: "Enregistré", musicSavedAlbums: "Albums enregistrés", musicFromAlbum: "Extrait de {title}", musicStation: "Station", musicPlayStation: "Lancer la station", musicAlbumFailed: "Impossible de charger cet album", musicArtistFailed: "Impossible de charger cet artiste", musicSingle: "Single", musicAlbum: "Album",
    musicMoods: "Humeurs et moments", musicGenres: "Genres", musicGenreFailed: "Impossible de charger ce genre", musicPlaylistFailed: "Impossible de charger cette playlist",
    musicYourPlaylists: "Vos playlists", musicSavedPlaylists: "Playlists enregistrées", musicNewPlaylist: "Nouvelle playlist", musicPlaylistName: "Nom de la playlist", musicCreate: "Créer", musicRenamePlaylist: "Renommer", musicDelete: "Supprimer", musicDeletePlaylist: "Supprimer la playlist", musicDeletePlaylistConfirm: "Supprimer « {name} » ? Les titres restent ailleurs là où ils sont.", musicPlaylistEmpty: "Aucun titre pour l’instant. Ajoutez-en avec Ajouter à une playlist.", musicRemoveFromPlaylist: "Retirer de la playlist", musicEditPlaylist: "Modifier", musicDoneEditing: "Terminé", musicMoveUp: "Monter", musicMoveDown: "Descendre", musicAddToPlaylist: "Ajouter à une playlist", musicAddedToPlaylist: "Ajouté à {name}", musicAlreadyInPlaylist: "Déjà dans {name}", musicActionFailed: "Un problème est survenu. Réessayez.",
  },
  es: {
    musicSwitchToMusic: "Cambiar a música", musicSwitchToVideo: "Cambiar a vídeos", musicSwitchHint: "La música tiene sus propios me gusta e historial",
    musicTitle: "Música", musicHome: "Inicio", musicSearch: "Buscar", musicLibrary: "Biblioteca",
    musicYourMix: "Tu mix", musicYourMixHint: "Canciones elegidas según lo que escuchas", musicLikedSongs: "Canciones que te gustan", musicLikedSongsHint: "Una emisora con las canciones que te gustan",
    musicRecent: "Escuchado recientemente", musicSearchHint: "Busca canciones, álbumes y artistas", musicNoResults: "No se encontró nada", musicSearchFailed: "La búsqueda ha fallado",
    musicLoadFailed: "No se pudo cargar tu música", musicLibraryEmpty: "Aquí aparecen los álbumes que guardas y las canciones que te gustan", musicRecentEmpty: "Busca una canción para iniciar una emisora",
    musicStartFailed: "No se pudo iniciar la música", musicStarting: "Iniciando…",
    musicNowPlaying: "Reproduciendo", musicUpNext: "A continuación", musicPlay: "Reproducir", musicPause: "Pausa", musicNext: "Siguiente canción", musicPrevious: "Canción anterior",
    musicLike: "Me gusta", musicUnlike: "Quitar me gusta", musicNotThis: "Esta no", musicRetry: "Reintentar",
    musicSleepEndOfSong: "Final de la canción", musicSleepStopped: "El temporizador ha pausado la música",
    musicSongs: "Canciones", musicAlbums: "Álbumes", musicArtists: "Artistas", musicSingles: "Sencillos y EP", musicTopSongs: "Canciones principales", musicShuffle: "Aleatorio", musicSave: "Guardar", musicSaved: "Guardado", musicSavedAlbums: "Álbumes guardados", musicFromAlbum: "De {title}", musicStation: "Emisora", musicPlayStation: "Iniciar emisora", musicAlbumFailed: "No se pudo cargar este álbum", musicArtistFailed: "No se pudo cargar este artista", musicSingle: "Sencillo", musicAlbum: "Álbum",
    musicMoods: "Estados de ánimo y momentos", musicGenres: "Géneros", musicGenreFailed: "No se pudo cargar este género", musicPlaylistFailed: "No se pudo cargar esta lista",
    musicYourPlaylists: "Tus listas", musicSavedPlaylists: "Listas guardadas", musicNewPlaylist: "Nueva lista", musicPlaylistName: "Nombre de la lista", musicCreate: "Crear", musicRenamePlaylist: "Cambiar nombre", musicDelete: "Eliminar", musicDeletePlaylist: "Eliminar lista", musicDeletePlaylistConfirm: "¿Eliminar «{name}»? Las canciones siguen donde estén fuera de ella.", musicPlaylistEmpty: "Aún no hay canciones. Añádelas con Añadir a una lista.", musicRemoveFromPlaylist: "Quitar de la lista", musicEditPlaylist: "Editar", musicDoneEditing: "Listo", musicMoveUp: "Subir", musicMoveDown: "Bajar", musicAddToPlaylist: "Añadir a una lista", musicAddedToPlaylist: "Añadida a {name}", musicAlreadyInPlaylist: "Ya está en {name}", musicActionFailed: "Algo salió mal. Inténtalo de nuevo.",
  },
  "pt-BR": {
    musicSwitchToMusic: "Mudar para música", musicSwitchToVideo: "Mudar para vídeos", musicSwitchHint: "A música tem curtidas e histórico próprios",
    musicTitle: "Música", musicHome: "Início", musicSearch: "Buscar", musicLibrary: "Biblioteca",
    musicYourMix: "Seu mix", musicYourMixHint: "Músicas escolhidas pelo que você ouve", musicLikedSongs: "Músicas curtidas", musicLikedSongsHint: "Uma estação com as músicas que você curte",
    musicRecent: "Tocadas recentemente", musicSearchHint: "Buscar músicas, álbuns e artistas", musicNoResults: "Nada encontrado", musicSearchFailed: "A busca falhou",
    musicLoadFailed: "Não foi possível carregar suas músicas", musicLibraryEmpty: "Os álbuns que você salvar e as músicas que curtir aparecem aqui", musicRecentEmpty: "Busque uma música para iniciar uma estação",
    musicStartFailed: "Não foi possível iniciar a música", musicStarting: "Iniciando…",
    musicNowPlaying: "Tocando agora", musicUpNext: "A seguir", musicPlay: "Tocar", musicPause: "Pausar", musicNext: "Próxima música", musicPrevious: "Música anterior",
    musicLike: "Curtir", musicUnlike: "Remover curtida", musicNotThis: "Esta não", musicRetry: "Tentar de novo",
    musicSleepEndOfSong: "Fim da música", musicSleepStopped: "O timer pausou a música",
    musicSongs: "Músicas", musicAlbums: "Álbuns", musicArtists: "Artistas", musicSingles: "Singles e EPs", musicTopSongs: "Músicas em alta", musicShuffle: "Aleatório", musicSave: "Salvar", musicSaved: "Salvo", musicSavedAlbums: "Álbuns salvos", musicFromAlbum: "De {title}", musicStation: "Estação", musicPlayStation: "Iniciar estação", musicAlbumFailed: "Não foi possível carregar este álbum", musicArtistFailed: "Não foi possível carregar este artista", musicSingle: "Single", musicAlbum: "Álbum",
    musicMoods: "Humores e momentos", musicGenres: "Gêneros", musicGenreFailed: "Não foi possível carregar este gênero", musicPlaylistFailed: "Não foi possível carregar esta playlist",
    musicYourPlaylists: "Suas playlists", musicSavedPlaylists: "Playlists salvas", musicNewPlaylist: "Nova playlist", musicPlaylistName: "Nome da playlist", musicCreate: "Criar", musicRenamePlaylist: "Renomear", musicDelete: "Excluir", musicDeletePlaylist: "Excluir playlist", musicDeletePlaylistConfirm: "Excluir “{name}”? As músicas continuam onde mais estiverem.", musicPlaylistEmpty: "Nenhuma música ainda. Adicione com Adicionar à playlist.", musicRemoveFromPlaylist: "Remover da playlist", musicEditPlaylist: "Editar", musicDoneEditing: "Concluído", musicMoveUp: "Mover para cima", musicMoveDown: "Mover para baixo", musicAddToPlaylist: "Adicionar à playlist", musicAddedToPlaylist: "Adicionada a {name}", musicAlreadyInPlaylist: "Já está em {name}", musicActionFailed: "Algo deu errado. Tente de novo.",
  },
  ru: {
    musicSwitchToMusic: "Перейти к музыке", musicSwitchToVideo: "Перейти к видео", musicSwitchHint: "У музыки свои лайки и история",
    musicTitle: "Музыка", musicHome: "Главная", musicSearch: "Поиск", musicLibrary: "Библиотека",
    musicYourMix: "Ваш микс", musicYourMixHint: "Треки по вашим прослушиваниям", musicLikedSongs: "Понравившиеся треки", musicLikedSongsHint: "Станция из треков, которые вам нравятся",
    musicRecent: "Недавно прослушанные", musicSearchHint: "Поиск треков, альбомов и исполнителей", musicNoResults: "Ничего не найдено", musicSearchFailed: "Не удалось выполнить поиск",
    musicLoadFailed: "Не удалось загрузить музыку", musicLibraryEmpty: "Здесь появятся сохранённые альбомы и понравившиеся треки", musicRecentEmpty: "Найдите трек, чтобы запустить станцию",
    musicStartFailed: "Не удалось включить музыку", musicStarting: "Запуск…",
    musicNowPlaying: "Сейчас играет", musicUpNext: "Далее", musicPlay: "Воспроизвести", musicPause: "Пауза", musicNext: "Следующий трек", musicPrevious: "Предыдущий трек",
    musicLike: "Нравится", musicUnlike: "Убрать лайк", musicNotThis: "Не этот", musicRetry: "Повторить",
    musicSleepEndOfSong: "Конец трека", musicSleepStopped: "Таймер сна приостановил музыку",
    musicSongs: "Треки", musicAlbums: "Альбомы", musicArtists: "Исполнители", musicSingles: "Синглы и EP", musicTopSongs: "Популярные треки", musicShuffle: "Перемешать", musicSave: "Сохранить", musicSaved: "Сохранено", musicSavedAlbums: "Сохранённые альбомы", musicFromAlbum: "Из альбома «{title}»", musicStation: "Станция", musicPlayStation: "Запустить станцию", musicAlbumFailed: "Не удалось загрузить альбом", musicArtistFailed: "Не удалось загрузить исполнителя", musicSingle: "Сингл", musicAlbum: "Альбом",
    musicMoods: "Настроения и моменты", musicGenres: "Жанры", musicGenreFailed: "Не удалось загрузить жанр", musicPlaylistFailed: "Не удалось загрузить плейлист",
    musicYourPlaylists: "Ваши плейлисты", musicSavedPlaylists: "Сохранённые плейлисты", musicNewPlaylist: "Новый плейлист", musicPlaylistName: "Название плейлиста", musicCreate: "Создать", musicRenamePlaylist: "Переименовать", musicDelete: "Удалить", musicDeletePlaylist: "Удалить плейлист", musicDeletePlaylistConfirm: "Удалить «{name}»? Треки останутся там, где они есть ещё.", musicPlaylistEmpty: "Пока пусто. Добавляйте треки через «Добавить в плейлист».", musicRemoveFromPlaylist: "Убрать из плейлиста", musicEditPlaylist: "Изменить", musicDoneEditing: "Готово", musicMoveUp: "Переместить вверх", musicMoveDown: "Переместить вниз", musicAddToPlaylist: "Добавить в плейлист", musicAddedToPlaylist: "Добавлено в «{name}»", musicAlreadyInPlaylist: "Уже есть в «{name}»", musicActionFailed: "Что-то пошло не так. Попробуйте ещё раз.",
  },
  ja: {
    musicSwitchToMusic: "音楽に切り替え", musicSwitchToVideo: "動画に切り替え", musicSwitchHint: "音楽の高評価と履歴は動画とは別です",
    musicTitle: "音楽", musicHome: "ホーム", musicSearch: "検索", musicLibrary: "ライブラリ",
    musicYourMix: "あなたのミックス", musicYourMixHint: "再生した曲に合わせて選曲", musicLikedSongs: "高評価した曲", musicLikedSongsHint: "高評価した曲からのステーション",
    musicRecent: "最近再生した曲", musicSearchHint: "曲、アルバム、アーティストを検索", musicNoResults: "見つかりませんでした", musicSearchFailed: "検索できませんでした",
    musicLoadFailed: "音楽を読み込めませんでした", musicLibraryEmpty: "保存したアルバムと高評価した曲がここに表示されます", musicRecentEmpty: "曲を検索してステーションを始めましょう",
    musicStartFailed: "音楽を再生できませんでした", musicStarting: "開始しています…",
    musicNowPlaying: "再生中", musicUpNext: "次の曲", musicPlay: "再生", musicPause: "一時停止", musicNext: "次の曲へ", musicPrevious: "前の曲へ",
    musicLike: "高評価", musicUnlike: "高評価を取り消す", musicNotThis: "この曲は除外", musicRetry: "再試行",
    musicSleepEndOfSong: "曲の終わり", musicSleepStopped: "スリープタイマーで音楽を一時停止しました",
    musicSongs: "曲", musicAlbums: "アルバム", musicArtists: "アーティスト", musicSingles: "シングルとEP", musicTopSongs: "人気曲", musicShuffle: "シャッフル", musicSave: "保存", musicSaved: "保存済み", musicSavedAlbums: "保存したアルバム", musicFromAlbum: "{title} から", musicStation: "ステーション", musicPlayStation: "ステーションを再生", musicAlbumFailed: "アルバムを読み込めませんでした", musicArtistFailed: "アーティストを読み込めませんでした", musicSingle: "シングル", musicAlbum: "アルバム",
    musicMoods: "ムードとシーン", musicGenres: "ジャンル", musicGenreFailed: "このジャンルを読み込めませんでした", musicPlaylistFailed: "このプレイリストを読み込めませんでした",
    musicYourPlaylists: "あなたのプレイリスト", musicSavedPlaylists: "保存したプレイリスト", musicNewPlaylist: "新しいプレイリスト", musicPlaylistName: "プレイリスト名", musicCreate: "作成", musicRenamePlaylist: "名前を変更", musicDelete: "削除", musicDeletePlaylist: "プレイリストを削除", musicDeletePlaylistConfirm: "「{name}」を削除しますか？曲はほかの場所に残ります。", musicPlaylistEmpty: "まだ曲がありません。「プレイリストに追加」から追加できます。", musicRemoveFromPlaylist: "プレイリストから削除", musicEditPlaylist: "編集", musicDoneEditing: "完了", musicMoveUp: "上へ移動", musicMoveDown: "下へ移動", musicAddToPlaylist: "プレイリストに追加", musicAddedToPlaylist: "{name} に追加しました", musicAlreadyInPlaylist: "すでに {name} にあります", musicActionFailed: "問題が発生しました。もう一度お試しください。",
  },
  hu: {
    musicSwitchToMusic: "Váltás zenére", musicSwitchToVideo: "Váltás videókra", musicSwitchHint: "A zenének saját kedvelései és előzményei vannak",
    musicTitle: "Zene", musicHome: "Kezdőlap", musicSearch: "Keresés", musicLibrary: "Könyvtár",
    musicYourMix: "Saját mix", musicYourMixHint: "Dalok aszerint, amit hallgatsz", musicLikedSongs: "Kedvelt dalok", musicLikedSongsHint: "Állomás a kedvelt dalaidból",
    musicRecent: "Nemrég játszott", musicSearchHint: "Dalok, albumok és előadók keresése", musicNoResults: "Nincs találat", musicSearchFailed: "A keresés nem sikerült",
    musicLoadFailed: "Nem sikerült betölteni a zenéidet", musicLibraryEmpty: "A mentett albumaid és kedvelt dalaid itt jelennek meg", musicRecentEmpty: "Keress egy dalt egy állomás indításához",
    musicStartFailed: "Nem sikerült elindítani a zenét", musicStarting: "Indítás…",
    musicNowPlaying: "Most szól", musicUpNext: "Következik", musicPlay: "Lejátszás", musicPause: "Szünet", musicNext: "Következő dal", musicPrevious: "Előző dal",
    musicLike: "Tetszik", musicUnlike: "Kedvelés visszavonása", musicNotThis: "Ezt ne", musicRetry: "Újra",
    musicSleepEndOfSong: "A dal végén", musicSleepStopped: "Az elalváskapcsoló szüneteltette a zenét",
    musicSongs: "Dalok", musicAlbums: "Albumok", musicArtists: "Előadók", musicSingles: "Kislemezek és EP-k", musicTopSongs: "Népszerű dalok", musicShuffle: "Keverés", musicSave: "Mentés", musicSaved: "Mentve", musicSavedAlbums: "Mentett albumok", musicFromAlbum: "Innen: {title}", musicStation: "Állomás", musicPlayStation: "Állomás indítása", musicAlbumFailed: "Nem sikerült betölteni az albumot", musicArtistFailed: "Nem sikerült betölteni az előadót", musicSingle: "Kislemez", musicAlbum: "Album",
    musicMoods: "Hangulatok és pillanatok", musicGenres: "Műfajok", musicGenreFailed: "Nem sikerült betölteni ezt a műfajt", musicPlaylistFailed: "Nem sikerült betölteni ezt a lejátszási listát",
    musicYourPlaylists: "Saját lejátszási listák", musicSavedPlaylists: "Mentett lejátszási listák", musicNewPlaylist: "Új lejátszási lista", musicPlaylistName: "Lejátszási lista neve", musicCreate: "Létrehozás", musicRenamePlaylist: "Átnevezés", musicDelete: "Törlés", musicDeletePlaylist: "Lejátszási lista törlése", musicDeletePlaylistConfirm: "Törlöd: „{name}”? A dalok máshol megmaradnak.", musicPlaylistEmpty: "Még nincs dal. A Hozzáadás lejátszási listához paranccsal adhatsz hozzá.", musicRemoveFromPlaylist: "Eltávolítás a listából", musicEditPlaylist: "Szerkesztés", musicDoneEditing: "Kész", musicMoveUp: "Mozgatás felfelé", musicMoveDown: "Mozgatás lefelé", musicAddToPlaylist: "Hozzáadás lejátszási listához", musicAddedToPlaylist: "Hozzáadva: {name}", musicAlreadyInPlaylist: "Már benne van: {name}", musicActionFailed: "Hiba történt. Próbáld újra.",
  },
};
