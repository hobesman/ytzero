package app.ytzero.musicplayer

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Keeps music playing with the screen off and shows its notification and
 * lock-screen controls. Media3 runs it in the foreground while music plays.
 *
 * It is also the music library Android Auto browses: see
 * [MusicLibraryCallback] for the tree and [CarStation] for stations started
 * from the car, which run here because the app's JS may not be running.
 */
class YtZeroMusicService : MediaLibraryService() {
  private var session: MediaLibrarySession? = null
  private var station: CarStation? = null
  private var background: ExecutorService? = null

  override fun onCreate() {
    super.onCreate()
    val player = MusicPlayerHolder.player(this)
    val executor = Executors.newFixedThreadPool(3)
    val carStation = CarStation({ MusicPlayerHolder.server(this) }, executor)
    carStation.attach(player)
    val builder = MediaLibrarySession.Builder(this, player, MusicLibraryCallback(this, carStation, executor)).setId("ytzero-music")
    // Tapping the notification opens the app in music mode.
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      launch.action = Intent.ACTION_VIEW
      launch.data = Uri.parse("ytzero://music")
      launch.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      builder.setSessionActivity(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }
    session = builder.build()
    station = carStation
    background = executor
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swiping the app away keeps music going only while it is actually playing.
    val player = session?.player
    if (player == null || !player.playWhenReady || player.mediaItemCount == 0) stopSelf()
  }

  override fun onDestroy() {
    // Records the song playing when a car station ends with the service.
    station?.release()
    station = null
    session?.release()
    session = null
    MusicPlayerHolder.release()
    background?.shutdown()
    background = null
    super.onDestroy()
  }
}
