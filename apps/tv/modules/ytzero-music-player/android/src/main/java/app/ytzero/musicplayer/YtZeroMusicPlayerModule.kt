package app.ytzero.musicplayer

import android.content.ComponentName
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class MusicTrackRecord : Record {
  @Field var videoId: String = ""
  @Field var url: String = ""
  @Field var title: String = ""
  @Field var artist: String = ""
  @Field var album: String? = null
  @Field var artwork: String? = null
}

/**
 * JS control of the music player: a queue of songs that ExoPlayer plays back
 * to back, buffering the next one before the current one ends.
 *
 * Events report each song's end with how far it got, so JS can record plays:
 * `onTrackChange` (reason "auto" when a song finished, "seek" when skipped,
 * "playlist" when the queue was replaced), `onStateChange` and `onError`.
 */
class YtZeroMusicPlayerModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var controller: ListenableFuture<MediaController>? = null
  private var listening: ExoPlayer? = null
  // The song playing and the furthest known position in it, for the report when it ends.
  private var currentId: String? = null
  private var currentPositionMs = 0L
  private var currentDurationMs = 0L
  private var consecutiveErrors = 0
  // Sleep timer: JS timers stop in the background, so the player checks it here.
  private var sleepDeadline = 0L
  private var sleepAtEndOfSong = false

  private val tick = object : Runnable {
    override fun run() {
      val player = MusicPlayerHolder.existing() ?: return
      remember(player)
      if (sleepDeadline > 0 && System.currentTimeMillis() >= sleepDeadline) {
        sleepDeadline = 0
        if (player.isPlaying) {
          player.pause()
          sendEvent("onSleep", mapOf<String, Any>())
        }
      }
      main.postDelayed(this, 500)
    }
  }

  private val listener = object : Player.Listener {
    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      val player = listening ?: return
      val previous = currentId?.let {
        mapOf("videoId" to it, "position" to currentPositionMs / 1000.0, "duration" to currentDurationMs / 1000.0)
      }
      currentId = mediaItem?.mediaId
      currentPositionMs = 0
      currentDurationMs = 0
      if (sleepAtEndOfSong && reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) {
        sleepAtEndOfSong = false
        player.pause()
        sendEvent("onSleep", mapOf<String, Any>())
      }
      sendEvent("onTrackChange", mapOf(
        "index" to player.currentMediaItemIndex,
        "videoId" to currentId,
        "reason" to when (reason) {
          Player.MEDIA_ITEM_TRANSITION_REASON_AUTO -> "auto"
          Player.MEDIA_ITEM_TRANSITION_REASON_SEEK -> "seek"
          Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT -> "repeat"
          else -> "playlist"
        },
        "previous" to previous,
      ))
    }

    override fun onEvents(player: Player, events: Player.Events) {
      if (events.containsAny(Player.EVENT_IS_PLAYING_CHANGED, Player.EVENT_PLAYBACK_STATE_CHANGED)) {
        if (player.playbackState == Player.STATE_READY) consecutiveErrors = 0
        sendState(player)
      }
    }

    override fun onPlayerError(error: PlaybackException) {
      val player = listening ?: return
      sendEvent("onError", mapOf("videoId" to currentId, "message" to (error.message ?: error.errorCodeName)))
      // One song that will not load should not stop the station; give up after a few in a row.
      consecutiveErrors++
      if (consecutiveErrors <= 3 && player.hasNextMediaItem()) {
        player.seekToNextMediaItem()
        player.prepare()
        player.play()
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("YtZeroMusicPlayer")
    Events("onTrackChange", "onStateChange", "onError", "onSleep")

    AsyncFunction("setAuthorization") { token: String? -> MusicPlayerHolder.setAuthorization(token) }

    // Pause at a wall-clock time (milliseconds since the epoch, 0 for none) or when the current song ends.
    AsyncFunction("setSleepTimer") { deadline: Double, endOfSong: Boolean ->
      sleepDeadline = deadline.toLong()
      sleepAtEndOfSong = endOfSong
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setQueue") { tracks: List<MusicTrackRecord>, startIndex: Int, play: Boolean ->
      val player = attach()
      currentId = null
      player.setMediaItems(tracks.map(::mediaItem), startIndex.coerceIn(0, maxOf(0, tracks.size - 1)), 0L)
      player.prepare()
      player.playWhenReady = play
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("append") { tracks: List<MusicTrackRecord> ->
      attach().addMediaItems(tracks.map(::mediaItem))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("removeAt") { index: Int ->
      val player = MusicPlayerHolder.existing() ?: return@AsyncFunction
      if (index in 0 until player.mediaItemCount && index != player.currentMediaItemIndex) player.removeMediaItem(index)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("skipTo") { index: Int ->
      val player = MusicPlayerHolder.existing() ?: return@AsyncFunction
      if (index in 0 until player.mediaItemCount) {
        player.seekTo(index, 0L)
        player.play()
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("play") {
      val player = MusicPlayerHolder.existing() ?: return@AsyncFunction
      if (player.playbackState == Player.STATE_IDLE) player.prepare()
      player.play()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("pause") { MusicPlayerHolder.existing()?.pause() }.runOnQueue(Queues.MAIN)

    AsyncFunction("next") {
      MusicPlayerHolder.existing()?.let { if (it.hasNextMediaItem()) it.seekToNextMediaItem() }
    }.runOnQueue(Queues.MAIN)

    // Restarts the song after its first few seconds, otherwise goes back one.
    AsyncFunction("previous") { MusicPlayerHolder.existing()?.seekToPrevious() }.runOnQueue(Queues.MAIN)

    AsyncFunction("seekTo") { seconds: Double ->
      MusicPlayerHolder.existing()?.seekTo((seconds * 1000).toLong().coerceAtLeast(0))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getState") {
      val player = MusicPlayerHolder.existing() ?: return@AsyncFunction null
      remember(player)
      state(player)
    }.runOnQueue(Queues.MAIN)

    // Ends music: the queue, the notification and the service. Reports how far the last song got.
    AsyncFunction("stop") {
      val player = MusicPlayerHolder.existing() ?: return@AsyncFunction null
      remember(player)
      val last = currentId?.let { mapOf("videoId" to it, "position" to currentPositionMs / 1000.0, "duration" to currentDurationMs / 1000.0) }
      detach()
      player.stop()
      player.clearMediaItems()
      // The service still holds this player for its session; it releases both when it is destroyed.
      controller?.let { MediaController.releaseFuture(it) }
      controller = null
      currentId = null
      last
    }.runOnQueue(Queues.MAIN)

    OnDestroy { main.post { detach() } }
  }

  private fun mediaItem(track: MusicTrackRecord): MediaItem {
    val metadata = MediaMetadata.Builder()
      .setTitle(track.title)
      .setArtist(track.artist)
      .setAlbumTitle(track.album)
      .setArtworkUri(track.artwork?.takeIf { it.isNotEmpty() }?.let(Uri::parse))
      .build()
    return MediaItem.Builder().setMediaId(track.videoId).setUri(track.url).setMediaMetadata(metadata).build()
  }

  /** The player, listened to, with the media session service bound so music keeps playing in the background. */
  private fun attach(): ExoPlayer {
    val context = appContext.reactContext ?: throw IllegalStateException("no context")
    val player = MusicPlayerHolder.player(context)
    if (controller == null) {
      controller = MediaController.Builder(context, SessionToken(context, ComponentName(context, YtZeroMusicService::class.java))).buildAsync()
    }
    if (listening !== player) {
      listening?.removeListener(listener)
      player.addListener(listener)
      listening = player
      main.removeCallbacks(tick)
      main.post(tick)
    }
    return player
  }

  private fun detach() {
    listening?.removeListener(listener)
    listening = null
    main.removeCallbacks(tick)
  }

  private fun remember(player: Player) {
    if (player.currentMediaItem?.mediaId != currentId) return
    currentPositionMs = maxOf(currentPositionMs, player.currentPosition)
    if (player.duration > 0) currentDurationMs = player.duration
  }

  private fun state(player: Player): Map<String, Any?> = mapOf(
    "index" to player.currentMediaItemIndex,
    "videoId" to player.currentMediaItem?.mediaId,
    "count" to player.mediaItemCount,
    "position" to player.currentPosition / 1000.0,
    "duration" to if (player.duration > 0) player.duration / 1000.0 else null,
    "playing" to player.isPlaying,
    "buffering" to (player.playbackState == Player.STATE_BUFFERING),
    "ended" to (player.playbackState == Player.STATE_ENDED),
  )

  private fun sendState(player: Player) = sendEvent("onStateChange", state(player))
}
