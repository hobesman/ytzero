package app.ytzero.appupdate

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import java.io.File

/**
 * Where a downloaded update waits, and what the old version leaves the new one.
 *
 * The APK lives in the app's cache (cache/updates/ytzero-<build>.apk): private
 * to the app, never in the user's Downloads, and cleared by Android if space
 * runs short. It is deleted once the new version runs (UpdatedReceiver, and
 * cleanup() at every start as a backstop), and kept until then so a cancelled
 * confirmation can be retried without downloading it again.
 *
 * The preferences hold only the last install's outcome and the localized text
 * of the "updated" notification; they are device-only and never backed up to
 * the instance.
 */
internal object UpdateFiles {
  private const val FOLDER = "updates"
  private const val PREFS = "ytzero.app-update"
  const val CHANNEL = "app_updates"

  fun directory(context: Context): File = File(context.cacheDir, FOLDER).also { if (!it.exists()) it.mkdirs() }

  fun apk(context: Context, build: Int): File = File(directory(context), "ytzero-$build.apk")

  fun part(context: Context, build: Int): File = File(directory(context), "ytzero-$build.apk.part")

  fun prefs(context: Context): SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  @Suppress("DEPRECATION")
  fun installedBuild(context: Context): Long {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
  }

  /** Deletes every update at or below the running build, and any download left half done for one of those. */
  fun cleanup(context: Context) {
    val installed = installedBuild(context)
    val pattern = Regex("""^ytzero-(\d+)\.apk(\.part)?$""")
    directory(context).listFiles()?.forEach { file ->
      val build = pattern.find(file.name)?.groupValues?.get(1)?.toLongOrNull()
      if (build == null || build <= installed) file.delete()
    }
  }

  fun deleteAll(context: Context) {
    directory(context).listFiles()?.forEach { it.delete() }
  }

  /** Posts "updated to build N" if the user allows notifications; tapping it opens the app. */
  fun notifyUpdated(context: Context) {
    val prefs = prefs(context)
    val title = prefs.getString("notifyTitle", null) ?: return
    val text = (prefs.getString("notifyText", null) ?: "").replace("{build}", installedBuild(context).toString())
    val channelName = prefs.getString("channelName", null) ?: title
    prefs.edit().remove("notifyTitle").remove("notifyText").apply()
    if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, channelName, NotificationManager.IMPORTANCE_DEFAULT))
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val open = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    @Suppress("DEPRECATION")
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL) else Notification.Builder(context)
    val notification = builder
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(title)
      .setContentText(text)
      .setContentIntent(open)
      .setAutoCancel(true)
      .build()
    manager.notify(NOTIFICATION_ID, notification)
  }

  private const val NOTIFICATION_ID = 7301
}
