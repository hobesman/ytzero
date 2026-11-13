package app.ytzero.musicplayer

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory

/**
 * The one music player in the app process, shared by the Expo module (which JS
 * drives) and the media session service (lock screen, notification, Bluetooth).
 * Used only on the main thread.
 */
@OptIn(UnstableApi::class)
object MusicPlayerHolder {
  private var player: ExoPlayer? = null
  private val http = DefaultHttpDataSource.Factory()
    .setUserAgent("YTZero-Music")
    .setConnectTimeoutMs(15_000)
    .setReadTimeoutMs(20_000)
  private var headers: Map<String, String> = emptyMap()

  fun setAuthorization(token: String?) {
    headers = if (token.isNullOrEmpty()) emptyMap() else mapOf("Authorization" to "Bearer $token")
    // The factory makes a new data source per item, so later loads use the new header.
    http.setDefaultRequestProperties(headers)
  }

  fun existing(): ExoPlayer? = player

  fun player(context: Context): ExoPlayer {
    player?.let { return it }
    val attributes = AudioAttributes.Builder()
      .setUsage(C.USAGE_MEDIA)
      .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
      .build()
    val created = ExoPlayer.Builder(context.applicationContext)
      .setMediaSourceFactory(DefaultMediaSourceFactory(context.applicationContext).setDataSourceFactory(http))
      .setAudioAttributes(attributes, true)
      .setHandleAudioBecomingNoisy(true)
      .setWakeMode(C.WAKE_MODE_NETWORK)
      .build()
    player = created
    return created
  }

  fun release() {
    player?.release()
    player = null
  }
}
