package app.ytzero.appupdate

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The phone app's own updates: it downloads the APK of a newer GitHub release
 * into its cache, checks it against the SHA-256 the release lists, and hands
 * it to Android's PackageInstaller, instead of the browser saving it to
 * Downloads. See UpdateFiles for where the file waits and when it goes.
 */
class YtZeroAppUpdateModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val busy = AtomicBoolean(false)
  @Volatile private var cancelled = false
  @Volatile private var progressBuild = 0
  @Volatile private var downloaded = 0L
  @Volatile private var total = -1L

  private fun metered(): Boolean {
    val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    return connectivity.activeNetwork == null || connectivity.isActiveNetworkMetered
  }

  override fun definition() = ModuleDefinition {
    Name("YtZeroAppUpdate")

    /** Mobile data, or no network at all. */
    Function("isMetered") { metered() }

    /** Whether the user has let YT Zero install apps ("Install unknown apps"). */
    Function("canInstall") { Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls() }

    /** Opens the system page where the user allows YT Zero to install apps. */
    Function("openInstallPermission") {
      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    /** Whether a checked download of this build is waiting to be installed. */
    Function("isDownloaded") { build: Int -> UpdateFiles.apk(context, build).exists() }

    Function("progress") { mapOf("build" to progressBuild, "downloaded" to downloaded.toDouble(), "total" to total.toDouble()) }

    /** Stops a running download; what it saved so far stays for the next attempt. */
    Function("cancel") { cancelled = true }

    /** Deletes updates for the running build or older. */
    Function("cleanup") { UpdateFiles.cleanup(context) }

    /** How the last install ended, if it ended without updating ("aborted", "failed", ...); read once. */
    Function("takeInstallResult") {
      val prefs = UpdateFiles.prefs(context)
      val result = prefs.getString("result", null)
      prefs.edit().remove("result").remove("message").apply()
      result
    }

    /**
     * Downloads build `build` from `url`, resuming a part saved earlier, and
     * keeps it only if its SHA-256 matches. With `wifiOnly`, stops when the
     * phone moves to mobile data. Answers "done", "metered", "network",
     * "corrupt", "cancelled" or "busy".
     */
    AsyncFunction("download") { url: String, sha256: String, build: Int, wifiOnly: Boolean ->
      require(url.startsWith("https://")) { "Updates download over HTTPS only" }
      require(Regex("^[0-9a-f]{64}$").matches(sha256)) { "Invalid SHA-256" }
      if (!busy.compareAndSet(false, true)) return@AsyncFunction "busy"
      cancelled = false
      progressBuild = build
      downloaded = 0L
      total = -1L
      try { fetch(url, sha256, build, wifiOnly) } finally { busy.set(false) }
    }

    /**
     * Asks to show notifications (Android 13+), so the "updated" note can
     * appear; the answer doesn't matter to the update itself.
     */
    AsyncFunction("requestNotifications") { promise: Promise ->
      if (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
        promise.resolve(true)
        return@AsyncFunction
      }
      Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, android.Manifest.permission.POST_NOTIFICATIONS)
    }

    /**
     * Hands a downloaded build to the installer. The localized text is for the
     * notification the new version posts once it runs. Answers "started",
     * "missing" (no checked download) or "failed".
     */
    AsyncFunction("install") { build: Int, title: String, text: String, channelName: String ->
      val apk = UpdateFiles.apk(context, build)
      if (!apk.exists()) return@AsyncFunction "missing"
      UpdateFiles.prefs(context).edit()
        .putString("notifyTitle", title).putString("notifyText", text).putString("channelName", channelName)
        .remove("result").remove("message").apply()
      try {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(context.packageName)
        params.setSize(apk.length())
        // Android 12+ updates the app without asking once it installed the running version itself.
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        if (Build.VERSION.SDK_INT >= 33) params.setPackageSource(PackageInstaller.PACKAGE_SOURCE_DOWNLOADED_FILE)
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
          apk.inputStream().use { input ->
            session.openWrite("base.apk", 0, apk.length()).use { output ->
              input.copyTo(output)
              session.fsync(output)
            }
          }
          val result = Intent(context, InstallResultReceiver::class.java).setPackage(context.packageName)
          // Mutable: the installer adds its status to the intent. It names its receiver, so it isn't implicit.
          val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
          session.commit(PendingIntent.getBroadcast(context, sessionId, result, flags).intentSender)
        }
        "started"
      } catch (_: Exception) {
        "failed"
      }
    }
  }

  private fun fetch(url: String, sha256: String, build: Int, wifiOnly: Boolean): String {
    val target = UpdateFiles.apk(context, build)
    if (target.exists()) return "done"
    val part = UpdateFiles.part(context, build)
    if (wifiOnly && metered()) return "metered"
    val start = if (part.exists()) part.length() else 0L
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
      connection.connectTimeout = 15_000
      connection.readTimeout = 30_000
      connection.instanceFollowRedirects = true
      if (start > 0) connection.setRequestProperty("Range", "bytes=$start-")
      val code = connection.responseCode
      val append = code == 206 && start > 0
      if (code != 200 && code != 206) {
        // 416: the saved part doesn't fit the file any more; start afresh next time.
        if (code == 416) part.delete()
        return "network"
      }
      val length = connection.contentLengthLong
      downloaded = if (append) start else 0L
      total = if (length < 0) -1L else length + downloaded
      connection.inputStream.use { input ->
        FileOutputStream(part, append).use { output ->
          val buffer = ByteArray(64 * 1024)
          var sinceCheck = 0L
          while (true) {
            if (cancelled) return "cancelled"
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
            downloaded += read
            sinceCheck += read
            if (wifiOnly && sinceCheck > 1_000_000) {
              sinceCheck = 0
              if (metered()) return "metered"
            }
          }
        }
      }
    } catch (_: Exception) {
      return "network"
    } finally {
      connection.disconnect()
    }
    if (hash(part) != sha256) {
      part.delete()
      return "corrupt"
    }
    if (!part.renameTo(target)) return "network"
    return "done"
  }

  private fun hash(file: java.io.File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }
}
