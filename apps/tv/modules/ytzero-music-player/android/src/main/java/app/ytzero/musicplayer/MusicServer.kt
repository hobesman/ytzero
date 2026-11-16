package app.ytzero.musicplayer

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class MusicServerException(message: String, val status: Int) : IOException(message)

/**
 * The car's conversation with the YT Zero server: the same `/api/music`
 * routes the phone's music screens use (see apps/tv/src/music/musicApi.ts).
 * Blocking; call it off the main thread.
 */
class MusicServer(val instance: String, private val token: String?) {
  fun library() = CatalogJson.library(get("/library"))
  fun search(query: String) = CatalogJson.search(get("/search?q=${encode(query.trim())}", 30_000))
  fun genres() = CatalogJson.genres(get("/genres", 30_000))
  fun genre(id: String) = CatalogJson.genreShelves(get("/genres/${encode(id)}", 30_000))
  fun albumTracks(browseId: String) = CatalogJson.albumTracks(get("/albums/${encode(browseId)}", 30_000))

  fun station(seed: StationSeed, served: List<String>, skipped: List<String>, count: Int = 10): CatalogStation {
    val body = JSONObject().put("seed", seed.toJson()).put("served", JSONArray(served)).put("skipped", JSONArray(skipped)).put("count", count)
    return CatalogJson.station(request("POST", "/station", body, 30_000))
  }

  fun prepare(videoId: String) { request("POST", "/tracks/${encode(videoId)}/prepare", JSONObject(), 30_000) }

  fun recordPlay(play: JSONObject) { request("POST", "/plays", play, 8_000) }

  fun audioUrl(videoId: String) = "$instance/api/music/tracks/${encode(videoId)}/audio"

  private fun get(path: String, timeout: Int = 20_000) = request("GET", path, null, timeout)

  private fun request(method: String, path: String, body: JSONObject?, timeout: Int): JSONObject {
    val connection = URL("$instance/api/music$path").openConnection() as HttpURLConnection
    try {
      connection.requestMethod = method
      connection.connectTimeout = 15_000
      connection.readTimeout = timeout
      connection.setRequestProperty("User-Agent", "YTZero-Music")
      connection.setRequestProperty("Accept", "application/json")
      if (!token.isNullOrEmpty()) connection.setRequestProperty("Authorization", "Bearer $token")
      if (body != null) {
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
      }
      val status = connection.responseCode
      val stream = if (status in 200..299) connection.inputStream else connection.errorStream
      val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
      val json = try { if (text.isBlank()) JSONObject() else JSONObject(text) } catch (_: Exception) { JSONObject() }
      if (status !in 200..299) throw MusicServerException(json.optString("error").ifEmpty { "HTTP $status" }, status)
      return json
    } finally {
      connection.disconnect()
    }
  }

  companion object {
    private val AUDIO_URL = Regex("^(https?://.+?)/api/music/tracks/[^/]+/audio$")

    /** The server a song's audio address belongs to, or null for any other address. */
    fun instanceOf(audioUrl: String): String? = AUDIO_URL.find(audioUrl)?.groupValues?.get(1)

    private fun encode(text: String) = URLEncoder.encode(text, "UTF-8").replace("+", "%20")
  }
}
