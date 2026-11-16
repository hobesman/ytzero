package app.ytzero.appupdate

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build

/**
 * The installer's answers to a committed session. Android asks first unless it
 * lets the app update itself silently (Android 12+, once YT Zero installed the
 * running version); then this shows its confirmation. Any other outcome is
 * kept for the app to read when it's next in front. Success needs nothing:
 * Android stops the old version and UpdatedReceiver runs in the new one.
 */
class InstallResultReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
      val confirm = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
      if (confirm != null) {
        confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { context.startActivity(confirm); return } catch (_: Exception) {}
      }
    }
    if (status == PackageInstaller.STATUS_SUCCESS) return
    val outcome = when (status) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> "failed"
      PackageInstaller.STATUS_FAILURE_ABORTED -> "aborted"
      PackageInstaller.STATUS_FAILURE_STORAGE -> "storage"
      PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "incompatible"
      else -> "failed"
    }
    UpdateFiles.prefs(context).edit()
      .putString("result", outcome)
      .putString("message", intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
      .apply()
  }
}
