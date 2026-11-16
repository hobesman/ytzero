package app.ytzero.phonedownloads

import android.app.DownloadManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.Uri
import android.os.StatFs
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL

/**
 * Videos saved on the phone for offline playback. Android's DownloadManager
 * fetches them, so a download keeps going with the app closed, shows its
 * progress in a notification and waits for Wi-Fi when asked to.
 *
 * Everything lives in the app's own folder on external storage
 * (Android/data/<package>/files/downloads): no storage permission, invisible to
 * the gallery (.nomedia), removed with the app, and outside the app's Auto
 * Backup rules, which include shared preferences only.
 *
 * A download is written to "<name>.part" and renamed when it is complete, so a
 * file without that suffix is always whole. DownloadManager.remove() deletes
 * the file it wrote, which after the rename is no longer there.
 */
class YtZeroPhoneDownloadsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val manager: DownloadManager
    get() = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

  private fun directory(): File {
    val root = context.getExternalFilesDir(null) ?: throw IllegalStateException("No app storage")
    val dir = File(root, FOLDER)
    if (!dir.exists()) dir.mkdirs()
    val marker = File(dir, ".nomedia")
    if (!marker.exists()) marker.createNewFile()
    return dir
  }

  /** A plain file name inside the downloads folder; anything with a path is refused. */
  private fun file(name: String): File {
    require(name.isNotEmpty() && !name.contains('/') && !name.contains('\\') && name != "." && name != "..") { "Invalid file name" }
    return File(directory(), name)
  }

  override fun definition() = ModuleDefinition {
    Name("YtZeroPhoneDownloads")

    Function("directoryUri") { Uri.fromFile(directory()).toString() }

    AsyncFunction("enqueue") { url: String, headers: Map<String, String>, name: String, title: String, allowMetered: Boolean ->
      val part = file("$name.part")
      if (part.exists()) part.delete()
      val request = DownloadManager.Request(Uri.parse(url))
        .setTitle(title)
        .setDestinationUri(Uri.fromFile(part))
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
        .setAllowedOverMetered(allowMetered)
        .setAllowedOverRoaming(allowMetered)
      headers.forEach { (key, value) -> request.addRequestHeader(key, value) }
      manager.enqueue(request).toString()
    }

    AsyncFunction("query") { ids: List<String> ->
      ids.map { id -> status(id) }
    }

    /** Moves a finished download to its final name and forgets the DownloadManager entry. */
    AsyncFunction("finish") { id: String, name: String ->
      val part = file("$name.part")
      val target = file(name)
      if (!part.exists()) return@AsyncFunction -1L
      if (target.exists()) target.delete()
      if (!part.renameTo(target)) return@AsyncFunction -1L
      manager.remove(id.toLong())
      target.length()
    }

    /** Stops a download and deletes what it wrote so far. */
    AsyncFunction("cancel") { id: String ->
      id.toLongOrNull()?.let { manager.remove(it) }
      true
    }

    /** Small files such as a thumbnail, fetched directly. Returns the size, or -1. */
    AsyncFunction("fetchFile") { url: String, headers: Map<String, String>, name: String ->
      val target = file(name)
      val temporary = file("$name.tmp")
      val connection = URL(url).openConnection() as HttpURLConnection
      try {
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        headers.forEach { (key, value) -> connection.setRequestProperty(key, value) }
        if (connection.responseCode !in 200..299) return@AsyncFunction -1L
        connection.inputStream.use { input -> temporary.outputStream().use { output -> input.copyTo(output) } }
        if (target.exists()) target.delete()
        if (!temporary.renameTo(target)) return@AsyncFunction -1L
        target.length()
      } catch (_: Exception) {
        temporary.delete()
        -1L
      } finally {
        connection.disconnect()
      }
    }

    /**
     * One piece of a file a server sends in ranges, such as a song's audio:
     * bytes [start, end] are appended to "<name>.part", which must already
     * hold exactly `start` bytes (0 starts it afresh). Returns the HTTP status
     * (-1 when the network failed), the bytes now in the part file, and the
     * whole file's size from Content-Range (-1 when unknown).
     */
    AsyncFunction("fetchRange") { url: String, headers: Map<String, String>, name: String, start: Long, end: Long ->
      val part = file("$name.part")
      if (start == 0L) part.delete()
      val have = if (part.exists()) part.length() else 0L
      if (have != start) return@AsyncFunction mapOf("status" to 416, "size" to have, "total" to -1L)
      var connection: HttpURLConnection? = null
      try {
        val opened = URL(url).openConnection() as HttpURLConnection
        connection = opened
        opened.connectTimeout = 15_000
        opened.readTimeout = 30_000
        headers.forEach { (key, value) -> opened.setRequestProperty(key, value) }
        opened.setRequestProperty("Range", "bytes=$start-$end")
        val code = opened.responseCode
        if (code != 206 && !(code == 200 && start == 0L)) return@AsyncFunction mapOf("status" to code, "size" to start, "total" to -1L)
        val total = if (code == 200) opened.contentLengthLong
          else opened.getHeaderField("Content-Range")?.substringAfterLast('/')?.toLongOrNull() ?: -1L
        FileOutputStream(part, true).use { output -> opened.inputStream.use { input -> input.copyTo(output) } }
        mapOf("status" to code, "size" to part.length(), "total" to total)
      } catch (_: Exception) {
        // Keep only whole pieces, so the next attempt resumes from a known point.
        if (part.exists()) RandomAccessFile(part, "rw").use { it.setLength(start) }
        mapOf("status" to -1, "size" to start, "total" to -1L)
      } finally {
        connection?.disconnect()
      }
    }

    /** Gives a completed "<name>.part" its final name. Returns the size, or -1. */
    AsyncFunction("completePart") { name: String ->
      val part = file("$name.part")
      val target = file(name)
      if (!part.exists()) return@AsyncFunction -1L
      if (target.exists()) target.delete()
      if (!part.renameTo(target)) return@AsyncFunction -1L
      target.length()
    }

    /** Whether the network in use is metered, such as mobile data; true when there is none. */
    Function("isMetered") {
      val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      connectivity.activeNetwork == null || connectivity.isActiveNetworkMetered
    }

    AsyncFunction("readText") { name: String ->
      val target = file(name)
      if (target.exists()) target.readText() else null
    }

    /** Written beside the old file and renamed over it, so a crash never leaves half a file. */
    AsyncFunction("writeText") { name: String, text: String ->
      val temporary = file("$name.tmp")
      temporary.writeText(text)
      val target = file(name)
      if (target.exists() && !target.delete()) throw IllegalStateException("Could not replace $name")
      if (!temporary.renameTo(target)) throw IllegalStateException("Could not write $name")
      true
    }

    AsyncFunction("deleteFile") { name: String ->
      file(name).delete()
      file("$name.part").delete()
      true
    }

    AsyncFunction("fileSize") { name: String ->
      val target = file(name)
      if (target.exists()) target.length() else -1L
    }

    AsyncFunction("freeBytes") {
      StatFs(directory().path).availableBytes
    }
  }

  private fun status(id: String): Map<String, Any?> {
    val number = id.toLongOrNull() ?: return mapOf("id" to id, "status" to "missing")
    manager.query(DownloadManager.Query().setFilterById(number)).use { cursor ->
      if (!cursor.moveToFirst()) return mapOf("id" to id, "status" to "missing")
      val state = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
      val reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
      val downloaded = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
      val total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
      val name = when (state) {
        DownloadManager.STATUS_PENDING -> "pending"
        DownloadManager.STATUS_RUNNING -> "running"
        DownloadManager.STATUS_PAUSED -> "paused"
        DownloadManager.STATUS_SUCCESSFUL -> "done"
        else -> "failed"
      }
      val waiting = if (state != DownloadManager.STATUS_PAUSED) null else when (reason) {
        DownloadManager.PAUSED_QUEUED_FOR_WIFI -> "wifi"
        DownloadManager.PAUSED_WAITING_FOR_NETWORK, DownloadManager.PAUSED_WAITING_TO_RETRY -> "network"
        else -> null
      }
      return mapOf(
        "id" to id, "status" to name, "downloaded" to downloaded, "total" to total,
        "waiting" to waiting, "reason" to if (state == DownloadManager.STATUS_FAILED) reason else null,
      )
    }
  }

  companion object {
    private const val FOLDER = "downloads"
  }
}
