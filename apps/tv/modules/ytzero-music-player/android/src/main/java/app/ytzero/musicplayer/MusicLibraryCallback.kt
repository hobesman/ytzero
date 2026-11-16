package app.ytzero.musicplayer

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSession.MediaItemsWithStartPosition
import androidx.media3.session.SessionError
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import java.util.concurrent.ExecutorService

/**
 * What Android Auto (and other media browsers) see: a browse tree of the
 * listener's music, search, and voice requests. Every playable item starts a
 * station, which [CarStation] keeps going.
 *
 * Root tabs: For you (Your mix, Liked songs), Recently played, Saved albums,
 * and Moods & genres.
 */
@OptIn(UnstableApi::class)
class MusicLibraryCallback(
  private val context: Context,
  private val station: CarStation,
  private val background: ExecutorService,
) : MediaLibrarySession.Callback {
  private val main = Handler(Looper.getMainLooper())
  private val cache = HashMap<String, Pair<Long, List<MediaItem>>>()
  private val searches = HashMap<String, List<MediaItem>>()

  private fun string(id: Int) = context.getString(id)

  override fun onGetLibraryRoot(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, params: LibraryParams?): ListenableFuture<LibraryResult<MediaItem>> =
    Futures.immediateFuture(LibraryResult.ofItem(folder(CatalogIds.ROOT, "YT Zero"), params))

  override fun onGetItem(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, mediaId: String): ListenableFuture<LibraryResult<MediaItem>> {
    val item = tabs().firstOrNull { it.mediaId == mediaId } ?: forYou().firstOrNull { it.mediaId == mediaId }
      ?: if (mediaId == CatalogIds.ROOT) folder(CatalogIds.ROOT, "YT Zero") else null
    return Futures.immediateFuture(if (item != null) LibraryResult.ofItem(item, null) else LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
  }

  override fun onGetChildren(
    session: MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String, page: Int, pageSize: Int, params: LibraryParams?,
  ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
    val fixed = when (parentId) {
      CatalogIds.ROOT -> tabs()
      CatalogIds.FOR_YOU -> forYou()
      else -> null
    }
    if (fixed != null) return Futures.immediateFuture(LibraryResult.ofItemList(pageOf(fixed, page, pageSize), params))
    return load(session, browser) { server ->
      pageOf(children(server, parentId) ?: throw MusicServerException("unknown folder", 404), page, pageSize)
    }.let { future -> transformList(future, params) }
  }

  override fun onSearch(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, query: String, params: LibraryParams?): ListenableFuture<LibraryResult<Void>> {
    val result = SettableFuture.create<LibraryResult<Void>>()
    background.execute {
      val items = try { MusicPlayerHolder.server(context)?.let { searchItems(it, query) } } catch (error: Exception) { Log.w(TAG, "search failed: ${error.message}"); null }
      main.post {
        if (items != null) searches[query] = items
        if (searches.size > 10) searches.remove(searches.keys.first { it != query })
        session.notifySearchResultChanged(browser, query, items?.size ?: 0, params)
      }
    }
    result.set(LibraryResult.ofVoid())
    return result
  }

  override fun onGetSearchResult(
    session: MediaLibrarySession, browser: MediaSession.ControllerInfo, query: String, page: Int, pageSize: Int, params: LibraryParams?,
  ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
    searches[query]?.let { return Futures.immediateFuture(LibraryResult.ofItemList(pageOf(it, page, pageSize), params)) }
    return transformList(load(session, browser) { server -> pageOf(searchItems(server, query), page, pageSize) }, params)
  }

  /**
   * The car picked something to play, or the Assistant heard "play … on YT
   * Zero". Items the player can already load (the phone's own) pass through.
   */
  override fun onSetMediaItems(
    session: MediaSession, controller: MediaSession.ControllerInfo, mediaItems: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long,
  ): ListenableFuture<MediaItemsWithStartPosition> {
    if (mediaItems.isNotEmpty() && mediaItems.all { it.localConfiguration != null }) {
      return Futures.immediateFuture(MediaItemsWithStartPosition(mediaItems, startIndex, startPositionMs))
    }
    val picked = mediaItems.getOrNull(if (startIndex == C.INDEX_UNSET) 0 else startIndex) ?: mediaItems.firstOrNull()
    return startStation(session, controller, picked?.mediaId.orEmpty(), picked?.requestMetadata?.searchQuery?.toString())
  }

  /** Play pressed in the car or on a headset with nothing queued: start Your mix. */
  override fun onPlaybackResumption(session: MediaSession, controller: MediaSession.ControllerInfo, isForPlayback: Boolean): ListenableFuture<MediaItemsWithStartPosition> {
    if (!isForPlayback) return Futures.immediateFailedFuture(UnsupportedOperationException("nothing to show"))
    return startStation(session, controller, CatalogIds.MIX, null)
  }

  private fun startStation(session: MediaSession, controller: MediaSession.ControllerInfo, mediaId: String, query: String?): ListenableFuture<MediaItemsWithStartPosition> {
    val result = SettableFuture.create<MediaItemsWithStartPosition>()
    background.execute {
      try {
        val server = MusicPlayerHolder.server(context) ?: throw MusicServerException("not set up", 0)
        val seed = CatalogIds.seedFor(mediaId)
          ?: query?.let(ListenRules::radioArtistQuery)?.let { ListenRules.radioSeed(server.search(it)) }
          ?: query?.takeIf { it.isNotBlank() }?.let { ListenRules.voiceSeed(server.search(it)) }
          ?: StationSeed("mix")
        val first = server.station(seed, emptyList(), emptyList())
        if (first.tracks.isEmpty()) throw MusicServerException("empty station", 404)
        main.post { result.set(MediaItemsWithStartPosition(station.begin(seed, first), 0, C.TIME_UNSET)) }
      } catch (error: Exception) {
        Log.w(TAG, "starting a station failed: ${error.message}")
        main.post { report(session, controller, error) }
        result.setException(error)
      }
    }
    return result
  }

  /** Shows why on the car's screen: sign in on the phone, or the server can't be reached. */
  private fun report(session: MediaSession, controller: MediaSession.ControllerInfo, error: Exception) {
    session.sendError(controller, sessionError(error))
  }

  private fun sessionError(error: Exception): SessionError {
    val status = (error as? MusicServerException)?.status
    return when (status) {
      0 -> SessionError(SessionError.ERROR_SESSION_SETUP_REQUIRED, string(R.string.ytzero_music_car_setup))
      401 -> SessionError(SessionError.ERROR_SESSION_AUTHENTICATION_EXPIRED, string(R.string.ytzero_music_car_setup))
      403 -> SessionError(SessionError.ERROR_PERMISSION_DENIED, string(R.string.ytzero_music_car_not_allowed))
      else -> SessionError(SessionError.ERROR_IO, string(R.string.ytzero_music_car_unreachable))
    }
  }

  private fun load(session: MediaSession, browser: MediaSession.ControllerInfo, read: (MusicServer) -> List<MediaItem>): ListenableFuture<Result<List<MediaItem>>> {
    val result = SettableFuture.create<Result<List<MediaItem>>>()
    background.execute {
      try {
        val server = MusicPlayerHolder.server(context) ?: throw MusicServerException("not set up", 0)
        result.set(Result.success(read(server)))
      } catch (error: Exception) {
        Log.w(TAG, "browsing failed: ${error.message}")
        if ((error as? MusicServerException)?.status == 401) main.post { MusicPlayerHolder.forgetSignIn() }
        main.post { report(session, browser, error) }
        result.set(Result.failure(error))
      }
    }
    return result
  }

  private fun transformList(future: ListenableFuture<Result<List<MediaItem>>>, params: LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
    val result = SettableFuture.create<LibraryResult<ImmutableList<MediaItem>>>()
    future.addListener({
      val value = future.get()
      result.set(value.fold(
        onSuccess = { LibraryResult.ofItemList(it, params) },
        onFailure = { LibraryResult.ofError(sessionError(it as? Exception ?: Exception(it))) },
      ))
    }, Runnable::run)
    return result
  }

  /** A folder's children from the server, cached for a minute so going back and forth stays quick. */
  private fun children(server: MusicServer, parentId: String): List<MediaItem>? {
    val key = "${server.instance} $parentId"
    synchronized(cache) {
      cache[key]?.let { (at, items) -> if (System.currentTimeMillis() - at < CACHE_MS) return items }
    }
    val items = when {
      parentId == CatalogIds.RECENT -> server.library().recent.map { track(it, CatalogIds.track(it.videoId)) }
      parentId == CatalogIds.ALBUMS -> server.library().albums.map { album(it) }
      parentId == CatalogIds.GENRES -> server.genres().map { genre ->
        folder(CatalogIds.genre(genre.id), genre.title, group = string(if (genre.group == "mood") R.string.ytzero_music_car_moods else R.string.ytzero_music_car_genre_group), grid = true)
      }
      else -> {
        CatalogIds.folderArgument(parentId, "album")?.let { browseId ->
          server.albumTracks(browseId).map { track(it, CatalogIds.albumTrack(browseId, it.videoId)) }
        } ?: CatalogIds.folderArgument(parentId, "genre")?.let { id ->
          server.genre(id).flatMap { shelf -> shelf.playlists.map { playlist(it, shelf.title) } }
        } ?: return null
      }
    }
    synchronized(cache) {
      if (cache.size > 40) cache.clear()
      cache[key] = System.currentTimeMillis() to items
    }
    return items
  }

  private fun searchItems(server: MusicServer, query: String): List<MediaItem> {
    val results = server.search(query)
    return results.tracks.take(20).map { track(it, CatalogIds.track(it.videoId), string(R.string.ytzero_music_car_songs)) } +
      results.albums.map { album(it, string(R.string.ytzero_music_car_albums)) } +
      results.artists.flatMap { artist ->
        listOf(
          playable(CatalogIds.artist(artist.channelId), artist.name, null, artist.thumbnail, MediaMetadata.MEDIA_TYPE_ARTIST, string(R.string.ytzero_music_car_artists)),
          playable(CatalogIds.artistRadio(artist.channelId), context.getString(R.string.ytzero_music_car_artist_radio, artist.name), null, artist.thumbnail, MediaMetadata.MEDIA_TYPE_RADIO_STATION, string(R.string.ytzero_music_car_artists)),
        )
      }
  }

  private fun tabs() = listOf(
    folder(CatalogIds.FOR_YOU, string(R.string.ytzero_music_car_for_you), grid = true),
    folder(CatalogIds.RECENT, string(R.string.ytzero_music_car_recent)),
    folder(CatalogIds.ALBUMS, string(R.string.ytzero_music_car_albums_saved), grid = true),
    folder(CatalogIds.GENRES, string(R.string.ytzero_music_car_genres)),
  )

  private fun forYou() = listOf(
    playable(CatalogIds.MIX, string(R.string.ytzero_music_car_mix), string(R.string.ytzero_music_car_mix_hint), null, MediaMetadata.MEDIA_TYPE_PLAYLIST),
    playable(CatalogIds.LIKED, string(R.string.ytzero_music_car_liked), string(R.string.ytzero_music_car_liked_hint), null, MediaMetadata.MEDIA_TYPE_PLAYLIST),
  )

  private fun track(track: CatalogTrack, mediaId: String, group: String? = null) =
    playable(mediaId, track.title, track.artist, track.thumbnail, MediaMetadata.MEDIA_TYPE_MUSIC, group)

  private fun album(album: CatalogAlbum, group: String? = null): MediaItem = item(
    CatalogIds.album(album.browseId), album.title, album.artist, album.thumbnail, MediaMetadata.MEDIA_TYPE_ALBUM,
    browsable = true, playable = true, extras = style(group, grid = false),
  )

  private fun playlist(playlist: CatalogPlaylist, group: String) =
    playable(CatalogIds.playlist(playlist.playlistId), playlist.title, playlist.subtitle, playlist.thumbnail, MediaMetadata.MEDIA_TYPE_PLAYLIST, group.ifEmpty { null })

  private fun playable(mediaId: String, title: String, subtitle: String?, artwork: String?, type: Int, group: String? = null) =
    item(mediaId, title, subtitle, artwork, type, browsable = false, playable = true, extras = style(group, grid = null))

  private fun folder(mediaId: String, title: String, group: String? = null, grid: Boolean = false) =
    item(mediaId, title, null, null, MediaMetadata.MEDIA_TYPE_FOLDER_MIXED, browsable = true, playable = false, extras = style(group, grid))

  /** Extras for how the car lays out a folder's children (grid or list) and the heading an item sits under. */
  private fun style(group: String?, grid: Boolean?): Bundle = Bundle().apply {
    if (group != null) putString(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_GROUP_TITLE, group)
    if (grid != null) {
      val value = if (grid) MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM else MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM
      putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE, value)
      putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE, value)
    }
  }

  private fun item(mediaId: String, title: String, subtitle: String?, artwork: String?, type: Int, browsable: Boolean, playable: Boolean, extras: Bundle): MediaItem {
    val metadata = MediaMetadata.Builder()
      .setTitle(title)
      .setArtist(subtitle)
      .setSubtitle(subtitle)
      .setArtworkUri(artwork?.let(Uri::parse))
      .setIsBrowsable(browsable)
      .setIsPlayable(playable)
      .setMediaType(type)
      .setExtras(extras)
      .build()
    return MediaItem.Builder().setMediaId(mediaId).setMediaMetadata(metadata).build()
  }

  private fun <T> pageOf(items: List<T>, page: Int, pageSize: Int): List<T> {
    if (pageSize <= 0 || pageSize == Int.MAX_VALUE) return items
    val from = page.toLong() * pageSize
    if (from >= items.size) return emptyList()
    return items.subList(from.toInt(), minOf(items.size, (from + pageSize).toInt()))
  }

  private companion object {
    const val TAG = "YtZeroMusicLibrary"
    const val CACHE_MS = 60_000L
  }
}
