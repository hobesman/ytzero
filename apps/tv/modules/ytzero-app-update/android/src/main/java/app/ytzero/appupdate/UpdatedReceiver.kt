package app.ytzero.appupdate

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Runs in the new version right after an update, however it was installed:
 * the downloaded installer is no longer needed, and Android doesn't reopen
 * the app, so a notification offers to.
 */
class UpdatedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    UpdateFiles.deleteAll(context)
    UpdateFiles.prefs(context).edit().remove("result").remove("message").apply()
    UpdateFiles.notifyUpdated(context)
  }
}
