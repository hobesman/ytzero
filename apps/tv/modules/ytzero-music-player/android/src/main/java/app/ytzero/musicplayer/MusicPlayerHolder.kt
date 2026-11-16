package app.ytzero.musicplayer

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.RenderersFactory
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory

/**
 * The one music player in the app process, shared by the Expo module (which JS
 * drives) and the media library service (lock screen, notification, Bluetooth,
 * Android Auto). Used only on the main thread.
 *
 * It also keeps the server and sign-in music last played with, so the car can
 * browse and play when the app's screens are not running.
 */
@OptIn(UnstableApi::class)
object MusicPlayerHolder {
  private var player: ExoPlayer? = null
  private val http = DefaultHttpDataSource.Factory()
    .setUserAgent("YTZero-Music")
    .setConnectTimeoutMs(15_000)
    .setReadTimeoutMs(20_000)
  @Volatile private var credentials: MusicCredentials? = null
  /** The token JS set before any context was at hand, to store once one is. */
  private var pendingToken: String? = null
  private var tokenPending = false
  @Volatile private var token: String? = null

  /**
   * Incognito mode on this device: listens started from the car are not
   * recorded either. Like the app's own switch, it starts off with the process.
   */
  @JvmStatic var incognito = false

  fun setAuthorization(token: String?) {
    applyToken(token)
    val store = credentials
    if (store == null) {
      pendingToken = token
      tokenPending = true
    } else {
      store.setToken(token)
    }
  }

  private fun applyToken(value: String?) {
    token = value?.takeIf { it.isNotEmpty() }
    // The factory makes a new data source per item, so later loads use the new header.
    http.setDefaultRequestProperties(token?.let { mapOf("Authorization" to "Bearer $it") } ?: emptyMap())
  }

  fun credentials(context: Context): MusicCredentials {
    credentials?.let { return it }
    val store = MusicCredentials(context)
    credentials = store
    if (tokenPending) {
      store.setToken(pendingToken)
      tokenPending = false
      pendingToken = null
    } else if (token == null) {
      // A start from the car, before JS ran: songs load with the stored sign-in.
      applyToken(store.token())
    }
    return store
  }

  /** The server to browse, with the sign-in songs load with; null until music has played on this phone. */
  fun server(context: Context): MusicServer? {
    val store = credentials(context)
    val instance = store.instance() ?: return null
    return MusicServer(instance, token)
  }

  /** The server turned the stored sign-in down. Playing music on the phone stores a fresh one. */
  fun forgetSignIn() {
    credentials?.forget()
  }

  fun existing(): ExoPlayer? = player

  fun player(context: Context): ExoPlayer {
    player?.let { return it }
    credentials(context)
    val created = buildPlayer(context)
    created.addListener(MusicLevelling.listener)
    created.addListener(object : Player.Listener {
      // The phone's songs name their server; the car browses that one.
      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        val uri = mediaItem?.localConfiguration?.uri?.toString() ?: return
        MusicServer.instanceOf(uri)?.let { credentials?.setInstance(it) }
      }
    })
    player = created
    return created
  }

  /** A player set up the way music plays. Tests pass their own renderers to hear what it outputs. */
  internal fun buildPlayer(context: Context, renderers: RenderersFactory? = null): ExoPlayer {
    val attributes = AudioAttributes.Builder()
      .setUsage(C.USAGE_MEDIA)
      .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
      .build()
    val app = context.applicationContext
    val builder = if (renderers == null) ExoPlayer.Builder(app) else ExoPlayer.Builder(app, renderers)
    // http(s) songs load with the sign-in header and downloaded songs from file:// addresses;
    // fragmented MP4 is read gaplessly.
    return builder
      .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(app, http), GaplessFragmentedMp4Extractor.FACTORY))
      .setAudioAttributes(attributes, true)
      .setHandleAudioBecomingNoisy(true)
      .setWakeMode(C.WAKE_MODE_NETWORK)
      .build()
  }

  fun release() {
    player?.release()
    player = null
  }
}
