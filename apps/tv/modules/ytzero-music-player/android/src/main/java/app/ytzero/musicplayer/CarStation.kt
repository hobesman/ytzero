package app.ytzero.musicplayer

import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ExecutorService

/**
 * A station started from the car (or the Assistant), run natively because
 * the app's JS may not be running: it keeps the queue a few songs ahead, has
 * the server ready the next song and records each listen, as the phone's
 * `MusicSession` does for stations started on the phone.
 *
 * Its songs carry a tag in their metadata. When the queue holds songs without
 * it, the phone has taken over and the station stops. Main thread only.
 */
class CarStation(private val server: () -> MusicServer?, private val background: ExecutorService) : Player.Listener {
  private val main = Handler(Looper.getMainLooper())
  private var player: Player? = null
  private var tag: String? = null
  private var seed: StationSeed? = null
  private var seedKey: String? = null
  private val served = ArrayList<String>()
  private val skipped = ArrayList<String>()
  private var refilling = false
  private var consecutiveErrors = 0
  // The song playing, when it started and the furthest point it reached.
  private var currentId: String? = null
  private var startedAt: String? = null
  private var positionMs = 0L
  private var durationMs = 0L

  private val tick = object : Runnable {
    override fun run() {
      player?.let(::remember)
      main.postDelayed(this, 1000)
    }
  }

  fun attach(player: Player) {
    if (this.player === player) return
    this.player?.removeListener(this)
    this.player = player
    player.addListener(this)
  }

  fun release() {
    finishCurrent(TrackEnd.REPLACED)
    stop()
    player?.removeListener(this)
    player = null
  }

  /**
   * The car picked a station: returns its first songs as player items. The
   * session then puts them in the player, replacing what played before.
   */
  fun begin(seed: StationSeed, station: CatalogStation): List<MediaItem> {
    finishCurrent(TrackEnd.REPLACED)
    stop()
    val next = "car-${System.nanoTime()}"
    tag = next
    this.seed = seed
    seedKey = station.seedKey
    served.clear()
    skipped.clear()
    consecutiveErrors = 0
    val tracks = station.tracks.distinctBy { it.videoId }
    served.addAll(tracks.map { it.videoId })
    main.post(tick)
    return tracks.map { item(it, next) }
  }

  private fun stop() {
    tag = null
    seed = null
    refilling = false
    main.removeCallbacks(tick)
  }

  override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
    val player = player ?: return
    if (tag == null) return
    finishCurrent(when (reason) {
      Player.MEDIA_ITEM_TRANSITION_REASON_AUTO, Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT -> TrackEnd.FINISHED
      Player.MEDIA_ITEM_TRANSITION_REASON_SEEK -> TrackEnd.SKIPPED
      else -> TrackEnd.REPLACED
    })
    if (mediaItem == null || tagOf(mediaItem) != tag) {
      // The phone replaced the queue (or it was cleared): its own session takes it from here.
      stop()
      return
    }
    currentId = mediaItem.mediaId
    startedAt = now()
    positionMs = 0
    durationMs = 0
    if (player.playbackState == Player.STATE_READY) consecutiveErrors = 0
    prepareNext(player)
    refillIfShort(player)
  }

  override fun onPlaybackStateChanged(playbackState: Int) {
    if (playbackState == Player.STATE_READY) consecutiveErrors = 0
  }

  override fun onPlayerError(error: PlaybackException) {
    if (tag == null) return
    // When the phone's module is listening it skips the song itself; act only if nothing has.
    main.post {
      val player = player ?: return@post
      if (tag == null || player.playerError == null) return@post
      consecutiveErrors++
      if (consecutiveErrors <= 3 && player.hasNextMediaItem()) {
        player.seekToNextMediaItem()
        player.prepare()
        player.play()
      }
    }
  }

  private fun remember(player: Player) {
    if (currentId == null || player.currentMediaItem?.mediaId != currentId) return
    positionMs = maxOf(positionMs, player.currentPosition)
    if (player.duration > 0) durationMs = player.duration
  }

  /** Records the song that just stopped playing, unless this device is in Incognito mode. */
  private fun finishCurrent(end: TrackEnd) {
    val videoId = currentId ?: return
    val started = startedAt ?: return
    player?.let(::remember)
    currentId = null
    val reason = ListenRules.endReason(end, positionMs / 1000.0, durationMs / 1000.0)
    if (reason == "skipped" && !skipped.contains(videoId)) {
      skipped.add(videoId)
      while (skipped.size > 100) skipped.removeAt(0)
    }
    val play = ListenRules.play(videoId, started, positionMs / 1000.0, durationMs / 1000.0, reason, seedKey) ?: return
    if (MusicPlayerHolder.incognito) return
    val target = server() ?: return
    background.execute {
      try { target.recordPlay(play) } catch (error: Exception) { Log.w(TAG, "recording a listen failed: ${error.message}") }
    }
  }

  private fun prepareNext(player: Player) {
    val index = player.currentMediaItemIndex + 1
    if (index >= player.mediaItemCount) return
    val videoId = player.getMediaItemAt(index).mediaId
    val target = server() ?: return
    background.execute { try { target.prepare(videoId) } catch (_: Exception) {} }
  }

  private fun refillIfShort(player: Player) {
    val ahead = player.mediaItemCount - player.currentMediaItemIndex - 1
    val seed = seed ?: return
    if (ahead >= QUEUE_AHEAD || refilling) return
    val target = server() ?: return
    val current = tag
    val alreadyServed = served.takeLast(200)
    val alreadySkipped = skipped.toList()
    refilling = true
    background.execute {
      val station = try { target.station(seed, alreadyServed, alreadySkipped) } catch (error: Exception) {
        Log.w(TAG, "refilling the station failed: ${error.message}")
        null
      }
      main.post {
        if (tag != current) return@post
        refilling = false
        val added = station?.tracks?.filter { !served.contains(it.videoId) }?.distinctBy { it.videoId }.orEmpty()
        if (added.isEmpty()) return@post
        served.addAll(added.map { it.videoId })
        val wasLast = player.currentMediaItemIndex == player.mediaItemCount - 1
        player.addMediaItems(added.map { item(it, current!!) })
        if (wasLast) prepareNext(player)
      }
    }
  }

  private fun item(track: CatalogTrack, tag: String): MediaItem {
    val target = server()
    val metadata = MediaMetadata.Builder()
      .setTitle(track.title)
      .setArtist(track.artist)
      .setAlbumTitle(track.album)
      .setArtworkUri(track.thumbnail?.let(Uri::parse))
      .setIsBrowsable(false)
      .setIsPlayable(true)
      .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
      .setExtras(Bundle().apply { putString(TAG_KEY, tag) })
      .build()
    return MediaItem.Builder()
      .setMediaId(track.videoId)
      .setUri(target?.audioUrl(track.videoId))
      .setMediaMetadata(metadata)
      .build()
  }

  private fun tagOf(item: MediaItem): String? = item.mediaMetadata.extras?.getString(TAG_KEY)

  private fun now(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    .apply { timeZone = TimeZone.getTimeZone("UTC") }
    .format(Date())

  private companion object {
    const val TAG = "YtZeroCarStation"
    const val TAG_KEY = "app.ytzero.station"
    /** Songs kept queued after the one playing, as on the phone. */
    const val QUEUE_AHEAD = 3
  }
}
