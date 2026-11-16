package app.ytzero.musicplayer

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Collections
import kotlin.concurrent.thread

/**
 * A stand-in YT Zero server on localhost: the music routes the car uses, each
 * song two seconds of silence, and a log of every request it was sent.
 */
class FakeMusicServer {
  data class Request(val method: String, val path: String, val authorization: String?, val body: String)

  private val socket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
  val url = "http://127.0.0.1:${socket.localPort}"
  val requests: MutableList<Request> = Collections.synchronizedList(ArrayList())
  @Volatile var stationCalls = 0
  private val wav = silence(seconds = 2)

  fun start(): FakeMusicServer {
    thread(isDaemon = true) {
      while (!socket.isClosed) {
        val client = try { socket.accept() } catch (_: Exception) { break }
        thread(isDaemon = true) { client.use(::serve) }
      }
    }
    return this
  }

  fun stop() = socket.close()

  fun posted(path: String): List<JSONObject> = synchronized(requests) {
    requests.filter { it.method == "POST" && it.path == path }.map { JSONObject(it.body) }
  }

  private fun serve(client: Socket) {
    val input = BufferedInputStream(client.getInputStream())
    val head = readHead(input) ?: return
    val lines = head.split("\r\n")
    val (method, path) = lines[0].split(" ").let { it[0] to it[1] }
    val headers = lines.drop(1).mapNotNull { line -> line.indexOf(':').takeIf { it > 0 }?.let { line.substring(0, it).trim().lowercase() to line.substring(it + 1).trim() } }.toMap()
    val length = headers["content-length"]?.toIntOrNull() ?: 0
    val body = ByteArray(length).also { var read = 0; while (read < length) { val n = input.read(it, read, length - read); if (n < 0) break; read += n } }
    requests.add(Request(method, path, headers["authorization"], String(body)))
    val out = client.getOutputStream()
    if (path.endsWith("/audio")) {
      out.write("HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: ${wav.size}\r\nConnection: close\r\n\r\n".toByteArray())
      if (method != "HEAD") out.write(wav)
      out.flush()
      return
    }
    val json = route(method, path).toString().toByteArray()
    out.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${json.size}\r\nConnection: close\r\n\r\n".toByteArray())
    out.write(json)
    out.flush()
  }

  private fun route(method: String, path: String): JSONObject = when {
    path == "/api/music/library" -> JSONObject()
      .put("liked", JSONArray())
      .put("recent", JSONArray().put(track("recent00001", "Recent one")).put(track("recent00002", "Recent two")))
      .put("albums", JSONArray().put(JSONObject().put("browseId", "MPREb_album1").put("title", "An album").put("artist", "Band").put("thumbnail", JSONObject.NULL)))
    path == "/api/music/genres" -> JSONObject().put("genres", JSONArray()
      .put(JSONObject().put("id", "mood1").put("title", "Chill").put("group", "mood"))
      .put(JSONObject().put("id", "genre1").put("title", "Rock").put("group", "genre")))
    path.startsWith("/api/music/search") -> JSONObject()
      .put("tracks", JSONArray().put(track("search00001", "Found song")))
      .put("albums", JSONArray())
      .put("artists", JSONArray().put(JSONObject().put("channelId", "UCartist").put("name", "Someone").put("thumbnail", JSONObject.NULL)))
    path == "/api/music/station" && method == "POST" -> {
      // Each call hands out two new songs, as the server's station would.
      val call = ++stationCalls
      JSONObject().put("seed", "mix").put("tracks", JSONArray().put(track("st${call}song0001".take(11), "Song ${call}a")).put(track("st${call}song0002".take(9) + "zz", "Song ${call}b")))
    }
    else -> JSONObject().put("ok", true)
  }

  private fun track(videoId: String, title: String) = JSONObject()
    .put("videoId", videoId).put("title", title).put("artist", "Band").put("album", JSONObject.NULL).put("thumbnail", JSONObject.NULL)

  private fun readHead(input: BufferedInputStream): String? {
    val bytes = ByteArrayOutputStream()
    var matched = 0
    val end = "\r\n\r\n"
    while (matched < 4) {
      val next = input.read()
      if (next < 0) return null
      bytes.write(next)
      matched = if (next.toChar() == end[matched]) matched + 1 else if (next.toChar() == '\r') 1 else 0
    }
    return bytes.toString("ISO-8859-1").trimEnd()
  }

  private fun silence(seconds: Int): ByteArray {
    val rate = 8000
    val data = rate * 2 * seconds
    return ByteBuffer.allocate(44 + data).order(ByteOrder.LITTLE_ENDIAN).apply {
      put("RIFF".toByteArray()); putInt(36 + data); put("WAVE".toByteArray())
      put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(1); putInt(rate); putInt(rate * 2); putShort(2); putShort(16)
      put("data".toByteArray()); putInt(data)
    }.array()
  }
}
