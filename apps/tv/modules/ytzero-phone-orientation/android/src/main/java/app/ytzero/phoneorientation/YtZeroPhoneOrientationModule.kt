package app.ytzero.phoneorientation

import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The app's screens are landscape TV layouts, which phones draw scaled down
 * until they have layouts of their own. `app.json` asks for landscape, but the
 * TV config plugin removes the manifest's orientation for Android TV, so phones
 * and tablets are held in landscape here. Televisions are left alone.
 */
class YtZeroPhoneOrientationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("YtZeroPhoneOrientation")
    OnCreate { holdLandscape() }
    OnActivityEntersForeground { holdLandscape() }
  }

  private fun holdLandscape() {
    val activity = appContext.currentActivity ?: return
    if (activity.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)) return
    if (activity.requestedOrientation != ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE) {
      activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    }
  }
}
