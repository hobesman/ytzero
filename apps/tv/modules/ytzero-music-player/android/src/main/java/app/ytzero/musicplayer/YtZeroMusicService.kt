package app.ytzero.musicplayer

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * Keeps music playing with the screen off and shows its notification and
 * lock-screen controls. Media3 runs it in the foreground while music plays.
 */
class YtZeroMusicService : MediaSessionService() {
  private var session: MediaSession? = null

  override fun onCreate() {
    super.onCreate()
    val builder = MediaSession.Builder(this, MusicPlayerHolder.player(this)).setId("ytzero-music")
    // Tapping the notification opens the app in music mode.
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      launch.action = Intent.ACTION_VIEW
      launch.data = Uri.parse("ytzero://music")
      launch.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      builder.setSessionActivity(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }
    session = builder.build()
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swiping the app away keeps music going only while it is actually playing.
    val player = session?.player
    if (player == null || !player.playWhenReady || player.mediaItemCount == 0) stopSelf()
  }

  override fun onDestroy() {
    session?.release()
    session = null
    MusicPlayerHolder.release()
    super.onDestroy()
  }
}
