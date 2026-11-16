package app.ytzero.musicplayer

import androidx.media3.common.Player
import kotlin.math.pow

/**
 * Volume levelling: each song plays turned down by how far it is above
 * YouTube's loudness target, as YouTube's own players do, so a loud master
 * doesn't jump out after a quiet one. Songs below the target play as they are:
 * turning them up could clip. The server sends each song's loudness; the
 * profile's setting turns levelling off. Used only on the main thread.
 */
object MusicLevelling {
  private const val REMEMBERED = 500

  /** dB above the target, by video id. */
  private val loudness = LinkedHashMap<String, Double>()

  var enabled = true
    set(value) {
      field = value
      MusicPlayerHolder.existing()?.let(::apply)
    }

  /** The volume for a song `db` above the target: attenuation only, and none when off or unknown. */
  fun gain(db: Double?, enabled: Boolean): Float {
    if (!enabled || db == null || !db.isFinite() || db <= 0.0) return 1f
    return 10.0.pow(-db.coerceAtMost(30.0) / 20.0).toFloat()
  }

  fun setLoudness(videoId: String, db: Double?) {
    if (db == null || !db.isFinite()) return
    loudness.remove(videoId)
    loudness[videoId] = db
    while (loudness.size > REMEMBERED) loudness.remove(loudness.keys.first())
    val player = MusicPlayerHolder.existing() ?: return
    if (player.currentMediaItem?.mediaId == videoId) apply(player)
  }

  fun apply(player: Player) {
    player.volume = gain(loudness[player.currentMediaItem?.mediaId], enabled)
  }

  /** Sets each song's volume as it starts. */
  val listener = object : Player.Listener {
    override fun onEvents(player: Player, events: Player.Events) {
      if (events.contains(Player.EVENT_MEDIA_ITEM_TRANSITION)) apply(player)
    }
  }
}
