package app.ytzero.musicplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MusicAudioTest {
  @Test fun trimsTheEncoderPrimingAndPaddingAnEditListDescribes() {
    // "Speak to Me" as YouTube serves it: 1600 samples of priming, 2,880,366 samples of song.
    assertEquals(GaplessTrim(1600, 594), AacGapless.trim(44_100, 44_100, 44_100, longArrayOf(2_880_366), longArrayOf(1600)))
    // The edit's duration is in the movie's timescale.
    assertEquals(GaplessTrim(2112, 1024 - (2112 + 48_000) % 1024), AacGapless.trim(48_000, 1000, 48_000, longArrayOf(1000), longArrayOf(2112)))
  }

  @Test fun leavesAnythingElseAsItWas() {
    assertNull(AacGapless.trim(44_100, 44_100, 44_100, null, null))
    assertNull(AacGapless.trim(44_100, 44_100, 44_100, longArrayOf(10, 20), longArrayOf(0, 5)))
    assertNull(AacGapless.trim(44_100, 44_100, 44_100, longArrayOf(1000), longArrayOf(0)))
    assertNull(AacGapless.trim(90_000, 1000, 44_100, longArrayOf(1000), longArrayOf(1600)))
    assertNull(AacGapless.trim(44_100, 44_100, 44_100, longArrayOf(1000), longArrayOf(50_000)))
  }

  @Test fun levellingOnlyTurnsLoudSongsDown() {
    assertEquals(1f, MusicLevelling.gain(null, true), 0f)
    assertEquals(1f, MusicLevelling.gain(-4.0, true), 0f)
    assertEquals(1f, MusicLevelling.gain(6.0, false), 0f)
    assertEquals(0.5012f, MusicLevelling.gain(6.0, true), 0.0001f)
    assertEquals(0.5182f, MusicLevelling.gain(5.71, true), 0.0001f)
    assertEquals(1f, MusicLevelling.gain(Double.NaN, true), 0f)
  }
}
