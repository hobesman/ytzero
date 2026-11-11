package app.ytzero.pictureinpicture

import androidx.activity.ComponentActivity
import androidx.core.app.PictureInPictureModeChangedInfo
import androidx.core.util.Consumer
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

/**
 * Tells the app when the viewer closes the picture-in-picture window.
 *
 * expo-video moves a playing video into picture in picture when the viewer leaves
 * the app, and the player keeps playing in the background after the window closes.
 * Closing the window should stop the video, but the app's JavaScript timers are
 * paused in picture in picture, so the app cannot tell a close from an expand.
 *
 * Android leaves picture in picture both ways: expanding resumes the activity, and
 * closing stops it. A stop while in or just out of picture in picture is a close.
 */
class YtZeroPictureInPictureModule : Module() {
  private var attached = WeakReference<ComponentActivity>(null)
  // Out of picture in picture and not resumed yet: a stop now means the window closed.
  private var leaving = false

  private val modeListener = Consumer<PictureInPictureModeChangedInfo> { info ->
    val activity = attached.get() ?: return@Consumer
    if (info.isInPictureInPictureMode) {
      leaving = false
    } else if (!activity.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
      // Already stopped: the window was closed.
      leaving = false
      dismissed()
    } else {
      leaving = true
    }
  }

  private val lifecycleObserver = LifecycleEventObserver { _, event ->
    val activity = attached.get() ?: return@LifecycleEventObserver
    when (event) {
      Lifecycle.Event.ON_RESUME -> leaving = false
      Lifecycle.Event.ON_STOP -> if (leaving || activity.isInPictureInPictureMode) {
        leaving = false
        dismissed()
      }
      else -> {}
    }
  }

  override fun definition() = ModuleDefinition {
    Name("YtZeroPictureInPicture")
    Events("onDismiss")
    OnCreate { attach() }
    OnActivityEntersForeground { attach() }
    OnDestroy { detach() }
  }

  private fun dismissed() = sendEvent("onDismiss", mapOf<String, Any>())

  private fun attach() {
    val activity = appContext.currentActivity as? ComponentActivity ?: return
    if (attached.get() === activity) return
    activity.runOnUiThread {
      if (attached.get() === activity) return@runOnUiThread
      detach()
      attached = WeakReference(activity)
      activity.addOnPictureInPictureModeChangedListener(modeListener)
      activity.lifecycle.addObserver(lifecycleObserver)
    }
  }

  private fun detach() {
    val activity = attached.get() ?: return
    attached = WeakReference(null)
    activity.runOnUiThread {
      activity.removeOnPictureInPictureModeChangedListener(modeListener)
      activity.lifecycle.removeObserver(lifecycleObserver)
    }
  }
}
