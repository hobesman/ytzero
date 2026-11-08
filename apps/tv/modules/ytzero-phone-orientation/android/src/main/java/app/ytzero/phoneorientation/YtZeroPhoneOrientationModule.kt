package app.ytzero.phoneorientation

import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.os.Build
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The phone window the current layout needs.
 *
 * Orientation: `app.json` asks for landscape, but the TV config plugin removes
 * the manifest's orientation for Android TV, so it is applied here instead:
 * landscape for the scaled TV layout, portrait for the phone layout while
 * browsing, and free rotation while a video plays. Televisions are left alone.
 *
 * Immersive: a fullscreen video hides the status and navigation bars; a swipe
 * from the edge shows them briefly.
 */
class YtZeroPhoneOrientationModule : Module() {
  private var mode = "landscape"
  private var immersive = false

  override fun definition() = ModuleDefinition {
    Name("YtZeroPhoneOrientation")
    OnCreate { apply() }
    OnActivityEntersForeground { apply() }
    AsyncFunction("setMode") { value: String ->
      mode = value
      appContext.currentActivity?.runOnUiThread { apply() }
    }
    AsyncFunction("setImmersive") { value: Boolean ->
      immersive = value
      appContext.currentActivity?.runOnUiThread { applyImmersive() }
    }
  }

  private fun apply() {
    applyImmersive()
    val activity = appContext.currentActivity ?: return
    if (activity.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)) return
    val requested = when (mode) {
      "portrait" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
      "sensor" -> ActivityInfo.SCREEN_ORIENTATION_FULL_USER
      else -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    }
    if (activity.requestedOrientation != requested) activity.requestedOrientation = requested
  }

  private fun applyImmersive() {
    val window = appContext.currentActivity?.window ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val controller = window.insetsController ?: return
      if (immersive) {
        controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsets.Type.systemBars())
      } else {
        controller.show(WindowInsets.Type.systemBars())
      }
    } else {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility = if (immersive) {
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
          View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
      } else {
        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
      }
    }
  }
}
