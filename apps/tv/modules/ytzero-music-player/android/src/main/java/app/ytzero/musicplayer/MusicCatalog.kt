package app.ytzero.musicplayer

import org.json.JSONArray
import org.json.JSONObject

/*
 * The music library as the car sees it, without Android types so it can be
 * unit tested: the server's JSON, the browse tree's media ids, the station
 * seeds they start, and when a song counts as listened to. The listen rules
 * follow the phone's JS queue (apps/tv/src/music/musicQueue.ts).
 */

data class CatalogTrack(val videoId: String, val title: String, val artist: String, val album: String?, val thumbnail: String?)
data class CatalogAlbum(val browseId: String, val title: String, val artist: String, val thumbnail: String?)
data class CatalogArtist(val channelId: String, val name: String, val thumbnail: String?)
data class CatalogGenre(val id: String, val title: String, val group: String)
data class CatalogPlaylist(val playlistId: String, val title: String, val subtitle: String, val thumbnail: String?)
data class CatalogShelf(val title: String, val playlists: List<CatalogPlaylist>)
data class CatalogLibrary(val liked: List<CatalogTrack>, val recent: List<CatalogTrack>, val albums: List<CatalogAlbum>)
data class CatalogSearch(val tracks: List<CatalogTrack>, val albums: List<CatalogAlbum>, val artists: List<CatalogArtist>)
data class CatalogStation(val seedKey: String?, val tracks: List<CatalogTrack>)

/** A station seed, as `POST /music/station` takes it. */
data class StationSeed(val kind: String, val id: String? = null, val startAt: String? = null) {
  fun toJson(): JSONObject {
    val json = JSONObject().put("kind", kind)
    when (kind) {
      "track" -> json.put("videoId", id)
      "album" -> { json.put("browseId", id); if (startAt != null) json.put("startAt", startAt) }
      "artist" -> json.put("artistId", id)
      "playlist" -> json.put("playlistId", id)
    }
    return json
  }
}

/** Media ids in the browse tree. Playable ids start a station; the rest are folders. */
object CatalogIds {
  const val ROOT = "root"
  const val FOR_YOU = "tab:foryou"
  const val RECENT = "tab:recent"
  const val ALBUMS = "tab:albums"
  const val GENRES = "tab:genres"
  const val MIX = "seed:mix"
  const val LIKED = "seed:liked"

  fun track(videoId: String) = "track:$videoId"
  fun album(browseId: String) = "album:$browseId"
  fun albumTrack(browseId: String, videoId: String) = "albumtrack:$browseId/$videoId"
  fun artist(channelId: String) = "artist:$channelId"
  fun genre(id: String) = "genre:$id"
  fun playlist(playlistId: String) = "playlist:$playlistId"

  /** The folder's id after its prefix, such as the genre id in `genre:<id>`. */
  fun folderArgument(mediaId: String, prefix: String): String? =
    mediaId.takeIf { it.startsWith("$prefix:") }?.substring(prefix.length + 1)?.takeIf { it.isNotEmpty() }

  /** The station a playable id starts, or null when the id plays nothing. */
  fun seedFor(mediaId: String): StationSeed? {
    if (mediaId == MIX) return StationSeed("mix")
    if (mediaId == LIKED) return StationSeed("liked")
    val colon = mediaId.indexOf(':')
    if (colon <= 0 || colon == mediaId.length - 1) return null
    val value = mediaId.substring(colon + 1)
    return when (mediaId.substring(0, colon)) {
      "track" -> StationSeed("track", value)
      "album" -> StationSeed("album", value)
      "artist" -> StationSeed("artist", value)
      "playlist" -> StationSeed("playlist", value)
      "albumtrack" -> {
        val slash = value.indexOf('/')
        if (slash <= 0 || slash == value.length - 1) null else StationSeed("album", value.substring(0, slash), value.substring(slash + 1))
      }
      else -> null
    }
  }
}

/** Reads the server's music JSON; missing or malformed entries are left out. */
object CatalogJson {
  private fun JSONObject.text(key: String): String? = if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }
  private fun <T> JSONArray?.items(read: (JSONObject) -> T?): List<T> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { index -> optJSONObject(index)?.let(read) }
  }

  fun track(json: JSONObject): CatalogTrack? {
    val videoId = json.text("videoId") ?: return null
    return CatalogTrack(videoId, json.text("title") ?: return null, json.text("artist") ?: "", json.text("album"), json.text("thumbnail"))
  }

  fun album(json: JSONObject): CatalogAlbum? {
    val browseId = json.text("browseId") ?: return null
    return CatalogAlbum(browseId, json.text("title") ?: return null, json.text("artist") ?: "", json.text("thumbnail"))
  }

  fun artist(json: JSONObject): CatalogArtist? {
    val channelId = json.text("channelId") ?: return null
    return CatalogArtist(channelId, json.text("name") ?: return null, json.text("thumbnail"))
  }

  fun tracks(array: JSONArray?) = array.items(::track)

  fun library(json: JSONObject) = CatalogLibrary(tracks(json.optJSONArray("liked")), tracks(json.optJSONArray("recent")), json.optJSONArray("albums").items(::album))

  fun search(json: JSONObject) = CatalogSearch(tracks(json.optJSONArray("tracks")), json.optJSONArray("albums").items(::album), json.optJSONArray("artists").items(::artist))

  fun station(json: JSONObject) = CatalogStation(json.text("seed"), tracks(json.optJSONArray("tracks")))

  fun genres(json: JSONObject): List<CatalogGenre> = json.optJSONArray("genres").items { genre ->
    val id = genre.text("id") ?: return@items null
    CatalogGenre(id, genre.text("title") ?: return@items null, if (genre.optString("group") == "mood") "mood" else "genre")
  }

  private fun playlist(json: JSONObject): CatalogPlaylist? {
    val playlistId = json.text("playlistId") ?: return null
    return CatalogPlaylist(playlistId, json.text("title") ?: return null, json.text("subtitle") ?: "", json.text("thumbnail"))
  }

  fun genreShelves(json: JSONObject): List<CatalogShelf> = json.optJSONArray("shelves").items { shelf ->
    CatalogShelf(shelf.text("title") ?: "", shelf.optJSONArray("playlists").items(::playlist)).takeIf { it.playlists.isNotEmpty() }
  }

  fun albumTracks(json: JSONObject) = tracks(json.optJSONArray("tracks"))
}

/** How a song stopped, as the server's `endReason` names it. */
enum class TrackEnd { FINISHED, SKIPPED, REPLACED }

object ListenRules {
  /** A song stopped this close to its end counts as finished. */
  private const val NEAR_END_SECONDS = 8.0

  fun endReason(end: TrackEnd, positionSeconds: Double, durationSeconds: Double): String {
    val nearEnd = durationSeconds > 0 && positionSeconds >= durationSeconds - NEAR_END_SECONDS
    return when {
      end == TrackEnd.FINISHED || nearEnd -> "completed"
      end == TrackEnd.SKIPPED -> "skipped"
      else -> "stopped"
    }
  }

  /** The body for `POST /music/plays`, or null when the song never really started. */
  fun play(videoId: String, startedAt: String, positionSeconds: Double, durationSeconds: Double, reason: String, seedKey: String?): JSONObject? {
    val duration = maxOf(0L, Math.round(durationSeconds))
    val listened = maxOf(0L, Math.round(positionSeconds))
    if (listened < 1 && reason != "completed") return null
    return JSONObject()
      .put("videoId", videoId)
      .put("startedAt", startedAt)
      .put("listenedSeconds", if (duration > 0) minOf(listened, duration) else listened)
      .put("duration", duration)
      .put("endReason", reason)
      .put("stationSeed", seedKey ?: JSONObject.NULL)
  }

  /** The song a spoken request ("play … on YT Zero") starts: a song, else an album, else an artist. */
  fun voiceSeed(results: CatalogSearch): StationSeed? = results.tracks.firstOrNull()?.let { StationSeed("track", it.videoId) }
    ?: results.albums.firstOrNull()?.let { StationSeed("album", it.browseId) }
    ?: results.artists.firstOrNull()?.let { StationSeed("artist", it.channelId) }
}
