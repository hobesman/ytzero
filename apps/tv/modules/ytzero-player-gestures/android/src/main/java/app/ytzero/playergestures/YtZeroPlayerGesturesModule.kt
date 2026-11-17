package app.ytzero.playergestures

import android.content.Context
import android.media.AudioManager
import android.provider.Settings
import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Brightness and volume for the fullscreen player's edge swipes.
 *
 * Brightness changes only this app's window, as video apps do: the system setting is untouched,
 * and `resetBrightness` hands the window back to it when the video leaves fullscreen.
 * Volume is the media stream's, without the system's volume panel; the player draws its own.
 * Levels are fractions from 0 to 1.
 */
class YtZeroPlayerGesturesModule : Module() {
  private val audio: AudioManager?
    get() = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("YtZeroPlayerGestures")

    Function("getBrightness") {
      val activity = appContext.currentActivity ?: return@Function 0.5
      val own = activity.window.attributes.screenBrightness
      if (own >= 0f) return@Function own.toDouble()
      // The window follows the system: read the system's level (0-255 on most phones).
      val system = try {
        Settings.System.getInt(activity.contentResolver, Settings.System.SCREEN_BRIGHTNESS)
      } catch (_: Settings.SettingNotFoundException) {
        128
      }
      (system / 255.0).coerceIn(0.0, 1.0)
    }

    // Fully dark would leave the viewer unable to see the screen to swipe it back.
    AsyncFunction("setBrightness") { level: Double -> setWindowBrightness(level.coerceIn(0.01, 1.0).toFloat()) }

    AsyncFunction("resetBrightness") { setWindowBrightness(WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE) }

    Function("getVolume") {
      val audio = audio ?: return@Function 0.5
      val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
      if (max <= 0) 0.0 else audio.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / max
    }

    Function("setVolume") { level: Double ->
      audio?.let { audio ->
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val index = Math.round(level.coerceIn(0.0, 1.0) * max).toInt()
        // Flag 0: no system volume panel over the video.
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, index, 0)
      }
      Unit
    }
  }

  private fun setWindowBrightness(brightness: Float) {
    val activity = appContext.currentActivity ?: return
    activity.runOnUiThread {
      val attributes = activity.window.attributes
      attributes.screenBrightness = brightness
      activity.window.attributes = attributes
    }
  }
}
