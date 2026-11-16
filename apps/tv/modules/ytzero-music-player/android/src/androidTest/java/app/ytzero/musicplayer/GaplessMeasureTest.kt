package app.ytzero.musicplayer

import android.content.Context
import android.util.Log
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DecoderReuseEvaluation
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.TeeAudioProcessor
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Measures gapless playback: plays two songs back to back through the music
 * player's media source setup and counts the PCM frames that reach the
 * speaker. Gapless means exactly the songs' own lengths, no more.
 *
 * Opt-in, since it needs real songs: serve them from the computer and run
 * `connectedDebugAndroidTest` with
 * `-Pandroid.testInstrumentationRunnerArguments.gaplessUrl=http://10.0.2.2:8765/a.m4a`
 * (and optionally `gaplessUrl2` for a different second song). Results are in
 * logcat under `GaplessMeasure`.
 */
@UnstableApi
@RunWith(AndroidJUnit4::class)
class GaplessMeasureTest {
  @Test fun measure() {
    val args = InstrumentationRegistry.getArguments()
    val url = args.getString("gaplessUrl")
    assumeTrue("pass gaplessUrl to measure", url != null)
    val second = args.getString("gaplessUrl2") ?: url!!
    val context = ApplicationProvider.getApplicationContext<Context>()
    var frames = 0L
    var channels = 2
    // Peak level per 10 ms window, to show what plays where the songs meet.
    val levels = ArrayList<Int>()
    var windowPeak = 0
    var windowFrames = 0
    val sink = object : TeeAudioProcessor.AudioBufferSink {
      override fun flush(sampleRateHz: Int, channelCount: Int, encoding: Int) {
        channels = channelCount
        Log.i(TAG, "flush rate=$sampleRateHz channels=$channelCount encoding=$encoding at frame=$frames")
      }

      override fun handleBuffer(buffer: ByteBuffer) {
        val shorts = buffer.duplicate().order(ByteOrder.nativeOrder()).asShortBuffer()
        while (shorts.remaining() >= channels) {
          var peak = 0
          repeat(channels) { peak = maxOf(peak, kotlin.math.abs(shorts.get().toInt())) }
          windowPeak = maxOf(windowPeak, peak)
          frames++
          if (++windowFrames == 441) { levels.add(windowPeak); windowPeak = 0; windowFrames = 0 }
        }
      }
    }
    val renderers = object : DefaultRenderersFactory(context) {
      override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioOutputPlaybackParams: Boolean): AudioSink =
        DefaultAudioSink.Builder(context).setAudioProcessors(arrayOf(TeeAudioProcessor(sink))).build()
    }
    val transitions = ArrayList<Long>()
    lateinit var player: ExoPlayer
    onMain {
      player = MusicPlayerHolder.buildPlayer(context, renderers)
      player.addAnalyticsListener(object : AnalyticsListener {
        override fun onAudioInputFormatChanged(eventTime: AnalyticsListener.EventTime, format: Format, decoderReuseEvaluation: DecoderReuseEvaluation?) {
          Log.i(TAG, "input ${format.sampleMimeType} rate=${format.sampleRate} encoderDelay=${format.encoderDelay} encoderPadding=${format.encoderPadding} at frame=$frames")
        }

        override fun onAudioTrackInitialized(eventTime: AnalyticsListener.EventTime, audioTrackConfig: AudioSink.AudioTrackConfig) {
          Log.i(TAG, "audio track initialized at frame=$frames")
        }
      })
      player.addListener(object : Player.Listener {
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) { transitions.add(frames) }
      })
      // gaplessUrl2=none plays one song, to tell what happens at the very end from what happens where songs meet.
      player.setMediaItems(if (second == "none") listOf(MediaItem.fromUri(url!!)) else listOf(MediaItem.fromUri(url!!), MediaItem.fromUri(second)))
      player.prepare()
      player.play()
    }
    val deadline = System.currentTimeMillis() + 600_000
    while (System.currentTimeMillis() < deadline && onMain { player.playbackState } != Player.STATE_ENDED) Thread.sleep(500)
    onMain { player.release() }
    Log.i(TAG, "RESULT total frames=$frames transitions=$transitions")
    args.getString("firstFrames")?.toLongOrNull()?.let { first ->
      val center = (first / 441).toInt()
      val from = maxOf(0, center - 10)
      Log.i(TAG, "RESULT peaks per 10 ms from frame ${from * 441}: ${levels.subList(from, minOf(levels.size, center + 15))}")
    }
  }

  private fun <T> onMain(block: () -> T): T {
    var result: Result<T>? = null
    InstrumentationRegistry.getInstrumentation().runOnMainSync { result = runCatching(block) }
    return result!!.getOrThrow()
  }

  private companion object { const val TAG = "GaplessMeasure" }
}
