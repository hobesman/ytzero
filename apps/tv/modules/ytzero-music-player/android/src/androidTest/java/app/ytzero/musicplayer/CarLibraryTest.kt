package app.ytzero.musicplayer

import android.content.ComponentName
import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaBrowser
import androidx.media3.session.SessionError
import androidx.media3.session.SessionToken
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.common.util.concurrent.ListenableFuture
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

/**
 * Talks to the music service the way Android Auto does, as a media browser,
 * against a fake YT Zero server: browsing, search, voice requests, and a
 * station that plays, refills and records listens without any JS.
 */
@RunWith(AndroidJUnit4::class)
class CarLibraryTest {
  private val context = ApplicationProvider.getApplicationContext<Context>()
  private lateinit var server: FakeMusicServer
  private lateinit var browser: MediaBrowser

  @Before fun setUp() {
    server = FakeMusicServer().start()
    onMain {
      MusicPlayerHolder.incognito = false
      MusicPlayerHolder.setAuthorization("test-token")
      MusicPlayerHolder.credentials(context).setInstance(server.url)
    }
    browser = onMain { MediaBrowser.Builder(context, SessionToken(context, ComponentName(context, YtZeroMusicService::class.java))).buildAsync() }.get(10, TimeUnit.SECONDS)
  }

  @After fun tearDown() {
    onMain { browser.stop(); browser.clearMediaItems(); browser.release() }
    server.stop()
  }

  @Test fun browsesTheTree() {
    val root = await { browser.getLibraryRoot(null) }.value!!
    assertEquals(CatalogIds.ROOT, root.mediaId)
    assertEquals(listOf(CatalogIds.FOR_YOU, CatalogIds.RECENT, CatalogIds.ALBUMS, CatalogIds.GENRES), children(CatalogIds.ROOT).map { it.mediaId })
    assertEquals(listOf(CatalogIds.MIX, CatalogIds.LIKED), children(CatalogIds.FOR_YOU).map { it.mediaId })
    val recent = children(CatalogIds.RECENT)
    assertEquals(listOf("track:recent00001", "track:recent00002"), recent.map { it.mediaId })
    assertEquals(true, recent[0].mediaMetadata.isPlayable)
    val albums = children(CatalogIds.ALBUMS)
    assertEquals(listOf("album:MPREb_album1"), albums.map { it.mediaId })
    assertEquals(true, albums[0].mediaMetadata.isBrowsable)
    assertEquals(listOf("genre:mood1", "genre:genre1"), children(CatalogIds.GENRES).map { it.mediaId })
    // Requests carry the profile's sign-in.
    assertTrue(server.requests.all { it.authorization == "Bearer test-token" })
  }

  @Test fun searchesSongsAndArtists() {
    val results = await { browser.getSearchResult("found", 0, 50, null) }.value!!
    assertEquals(listOf("track:search00001", "artist:UCartist"), results.map { it.mediaId })
  }

  @Test fun playsAStationThatRefillsAndRecordsListens() {
    onMain {
      browser.setMediaItems(listOf(MediaItem.Builder().setMediaId(CatalogIds.MIX).build()))
      browser.prepare()
      browser.play()
    }
    // Two songs arrive; fewer than three ahead, so the station asks for more.
    waitFor("refill") { server.stationCalls >= 2 }
    val refill = server.posted("/api/music/station").last()
    assertEquals("mix", refill.getJSONObject("seed").getString("kind"))
    assertTrue(refill.getJSONArray("served").length() >= 2)
    // The first two-second song finishes and is recorded as a listen.
    waitFor("a recorded listen") { server.posted("/api/music/plays").isNotEmpty() }
    val play = server.posted("/api/music/plays").first()
    assertEquals("st1song0001", play.getString("videoId"))
    assertEquals("completed", play.getString("endReason"))
    assertEquals("mix", play.getString("stationSeed"))
    assertTrue(onMain { browser.mediaItemCount } >= 3)
    assertTrue(server.requests.any { it.path == "/api/music/tracks/st1song0001/audio" && it.authorization == "Bearer test-token" })
  }

  @Test fun incognitoRecordsNothing() {
    onMain {
      MusicPlayerHolder.incognito = true
      browser.setMediaItems(listOf(MediaItem.Builder().setMediaId(CatalogIds.MIX).build()))
      browser.prepare()
      browser.play()
    }
    waitFor("the second song") { onMain { browser.currentMediaItemIndex } >= 1 }
    Thread.sleep(1000)
    assertEquals(0, server.posted("/api/music/plays").size)
  }

  @Test fun voiceStartsAStationFromTheFirstSong() {
    onMain {
      val spoken = MediaItem.Builder().setRequestMetadata(MediaItem.RequestMetadata.Builder().setSearchQuery("found song").build()).build()
      browser.setMediaItems(listOf(spoken))
      browser.prepare()
    }
    waitFor("a station") { server.stationCalls >= 1 }
    val seed = server.posted("/api/music/station").first().getJSONObject("seed")
    assertEquals("track", seed.getString("kind"))
    assertEquals("search00001", seed.getString("videoId"))
  }

  @Test fun thePhoneTakingOverEndsTheStation() {
    onMain {
      browser.setMediaItems(listOf(MediaItem.Builder().setMediaId(CatalogIds.MIX).build()))
      browser.prepare()
    }
    waitFor("refill") { server.stationCalls >= 2 }
    onMain {
      // The phone's module sets its songs on the player directly, with their audio address.
      val player = MusicPlayerHolder.existing()!!
      player.setMediaItems(listOf(MediaItem.Builder().setMediaId("phone000001").setUri("${server.url}/api/music/tracks/phone000001/audio").build()))
      player.prepare()
      player.play()
    }
    waitFor("the phone's song") { onMain { browser.currentMediaItem?.mediaId } == "phone000001" }
    val calls = server.stationCalls
    Thread.sleep(3000)
    assertEquals(calls, server.stationCalls)
  }

  @Test fun asksForThePhoneBeforeMusicHasPlayedThere() {
    onMain { MusicPlayerHolder.forgetSignIn() }
    val result = await { browser.getChildren(CatalogIds.RECENT, 0, 50, null) }
    assertEquals(SessionError.ERROR_SESSION_SETUP_REQUIRED, result.resultCode)
  }

  private fun children(parentId: String): List<MediaItem> {
    val result = await { browser.getChildren(parentId, 0, 100, null) }
    assertEquals("children of $parentId", LibraryResult.RESULT_SUCCESS, result.resultCode)
    return result.value!!
  }

  private fun <T> await(call: () -> ListenableFuture<T>): T = onMain(call).get(15, TimeUnit.SECONDS)

  private fun waitFor(what: String, condition: () -> Boolean) {
    val deadline = System.currentTimeMillis() + 30_000
    while (!condition()) {
      if (System.currentTimeMillis() > deadline) throw AssertionError("timed out waiting for $what; requests: ${server.requests.map { "${it.method} ${it.path}" }}")
      Thread.sleep(200)
    }
  }

  private fun <T> onMain(block: () -> T): T {
    var result: Result<T>? = null
    InstrumentationRegistry.getInstrumentation().runOnMainSync { result = runCatching(block) }
    return result!!.getOrThrow()
  }
}
