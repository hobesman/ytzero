package app.ytzero.musicplayer

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorsFactory
import androidx.media3.extractor.mp4.FragmentedMp4Extractor
import androidx.media3.extractor.mp4.Track

/** The encoder's priming at the start of a song and its padding at the end, in samples, which gapless playback leaves out. */
data class GaplessTrim(val delay: Int, val padding: Int)

object AacGapless {
  private const val AAC_FRAME_SAMPLES = 1024L

  /**
   * The trim an MP4 edit list describes for an AAC track: one edit that
   * starts `mediaTime` samples in (the priming) and lasts the song's real
   * length. The encoder fills its last frame with padding, so the decoded
   * length is the priming plus the song rounded up to whole 1024-sample frames.
   * Null for anything else, which then plays as it did before.
   */
  fun trim(timescale: Long, movieTimescale: Long, sampleRate: Int, editDurations: LongArray?, editMediaTimes: LongArray?): GaplessTrim? {
    if (editDurations?.size != 1 || editMediaTimes?.size != 1) return null
    // Only when the track counts time in samples, as YouTube's audio does.
    if (sampleRate <= 0 || timescale != sampleRate.toLong() || movieTimescale <= 0) return null
    val delay = editMediaTimes[0]
    if (delay <= 0 || delay > 10_000) return null
    val samples = editDurations[0] * timescale / movieTimescale
    if (samples <= 0) return null
    val decoded = (delay + samples + AAC_FRAME_SAMPLES - 1) / AAC_FRAME_SAMPLES * AAC_FRAME_SAMPLES
    val padding = decoded - delay - samples
    return GaplessTrim(delay.toInt(), padding.toInt())
  }
}

/**
 * YouTube serves songs as fragmented MP4 whose edit list says how much of the
 * AAC encoder's priming and padding to leave out. Media3's fragmented MP4
 * reader only uses an edit list to shift timestamps, which drops whole frames
 * at the start of the first song and leaves about 30 ms of near-silence where
 * songs meet. This reader passes it on as encoder delay and padding instead,
 * which the player trims to the sample at every song, so albums play without gaps.
 */
@OptIn(UnstableApi::class)
class GaplessFragmentedMp4Extractor : FragmentedMp4Extractor(0) {
  override fun modifyTrack(track: Track?): Track? {
    if (track == null) return null
    val format = track.format
    if (track.type != C.TRACK_TYPE_AUDIO || format.sampleMimeType != MimeTypes.AUDIO_AAC) return track
    val trim = AacGapless.trim(track.timescale, track.movieTimescale, format.sampleRate, track.editListDurations, track.editListMediaTimes) ?: return track
    return track.copyWithoutEditLists().copyWithFormat(format.buildUpon().setEncoderDelay(trim.delay).setEncoderPadding(trim.padding).build())
  }

  companion object {
    /** Every format Media3 reads, with fragmented MP4 read gaplessly. */
    val FACTORY = ExtractorsFactory { arrayOf<Extractor>(GaplessFragmentedMp4Extractor()) + DefaultExtractorsFactory().createExtractors() }
  }
}
