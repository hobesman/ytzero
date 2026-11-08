package app.ytzero.phoneorientation

import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Holds phones and tablets in the orientation the current layout needs.
 * `app.json` asks for landscape, but the TV config plugin removes the
 * manifest's orientation for Android TV, so it is applied here instead:
 * landscape for the scaled TV layout, portrait for the phone layout while
 * browsing, and free rotation while a video plays. Televisions are left alone.
 */
class YtZeroPhoneOrientationModule : Module() {
  private var mode = "landscape"

  override fun definition() = ModuleDefinition {
    Name("YtZeroPhoneOrientation")
    OnCreate { apply() }
    OnActivityEntersForeground { apply() }
    AsyncFunction("setMode") { value: String ->
      mode = value
      appContext.currentActivity?.runOnUiThread { apply() }
    }
  }

  private fun apply() {
    val activity = appContext.currentActivity ?: return
    if (activity.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)) return
    val requested = when (mode) {
      "portrait" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
      "sensor" -> ActivityInfo.SCREEN_ORIENTATION_FULL_USER
      else -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    }
    if (activity.requestedOrientation != requested) activity.requestedOrientation = requested
  }
}
