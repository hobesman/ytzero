package app.ytzero.musicplayer

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MusicCatalogTest {
  @Test fun playableIdsStartTheirStations() {
    assertEquals(StationSeed("mix"), CatalogIds.seedFor(CatalogIds.MIX))
    assertEquals(StationSeed("liked"), CatalogIds.seedFor(CatalogIds.LIKED))
    assertEquals(StationSeed("track", "dQw4w9WgXcQ"), CatalogIds.seedFor(CatalogIds.track("dQw4w9WgXcQ")))
    assertEquals(StationSeed("album", "MPREb_abc"), CatalogIds.seedFor(CatalogIds.album("MPREb_abc")))
    assertEquals(StationSeed("album", "MPREb_abc", "dQw4w9WgXcQ"), CatalogIds.seedFor(CatalogIds.albumTrack("MPREb_abc", "dQw4w9WgXcQ")))
    assertEquals(StationSeed("artist", "UC123"), CatalogIds.seedFor(CatalogIds.artist("UC123")))
    assertEquals(StationSeed("playlist", "RDCLAK5uy"), CatalogIds.seedFor(CatalogIds.playlist("RDCLAK5uy")))
  }

  @Test fun foldersAndMalformedIdsPlayNothing() {
    for (id in listOf(CatalogIds.ROOT, CatalogIds.FOR_YOU, CatalogIds.RECENT, CatalogIds.ALBUMS, CatalogIds.GENRES, "genre:abc", "track:", "albumtrack:MPREb_abc", "albumtrack:/x", "", "dQw4w9WgXcQ")) {
      assertNull(id, CatalogIds.seedFor(id))
    }
    assertEquals("abc", CatalogIds.folderArgument("genre:abc", "genre"))
    assertNull(CatalogIds.folderArgument("genre:", "genre"))
    assertNull(CatalogIds.folderArgument("album:abc", "genre"))
  }

  @Test fun seedsSerializeAsTheServerParsesThem() {
    assertEquals("""{"kind":"mix"}""", StationSeed("mix").toJson().toString())
    assertEquals("dQw4w9WgXcQ", StationSeed("track", "dQw4w9WgXcQ").toJson().getString("videoId"))
    val album = StationSeed("album", "MPREb_abc", "dQw4w9WgXcQ").toJson()
    assertEquals("MPREb_abc", album.getString("browseId"))
    assertEquals("dQw4w9WgXcQ", album.getString("startAt"))
    assertEquals(false, StationSeed("album", "MPREb_abc").toJson().has("startAt"))
    assertEquals("UC123", StationSeed("artist", "UC123").toJson().getString("artistId"))
    assertEquals("PL1", StationSeed("playlist", "PL1").toJson().getString("playlistId"))
  }

  @Test fun readsLibraryAndSkipsBrokenEntries() {
    val library = CatalogJson.library(JSONObject("""
      {"liked":[],"recent":[
        {"videoId":"aaaaaaaaaaa","title":"One","artist":"A","album":null,"thumbnail":"https://i/1.jpg"},
        {"videoId":"bbbbbbbbbbb"},
        {"title":"No id"}
      ],"albums":[{"browseId":"MPREb_1","title":"Album","artist":"A","thumbnail":null}]}
    """))
    assertEquals(listOf(CatalogTrack("aaaaaaaaaaa", "One", "A", null, "https://i/1.jpg")), library.recent)
    assertEquals(listOf(CatalogAlbum("MPREb_1", "Album", "A", null)), library.albums)
    assertEquals(emptyList<CatalogTrack>(), CatalogJson.library(JSONObject("{}")).liked)
  }

  @Test fun readsGenresStationsAndShelves() {
    val genres = CatalogJson.genres(JSONObject("""{"genres":[{"id":"g1","title":"Chill","group":"mood"},{"id":"g2","title":"Rock","group":"genre"},{"id":"g3"}]}"""))
    assertEquals(listOf(CatalogGenre("g1", "Chill", "mood"), CatalogGenre("g2", "Rock", "genre")), genres)
    val shelves = CatalogJson.genreShelves(JSONObject("""{"shelves":[{"title":"Top","playlists":[{"playlistId":"PL1","title":"Hits","subtitle":"YouTube Music"}]},{"title":"Empty","playlists":[]}]}"""))
    assertEquals(listOf(CatalogShelf("Top", listOf(CatalogPlaylist("PL1", "Hits", "YouTube Music", null)))), shelves)
    val station = CatalogJson.station(JSONObject("""{"seed":"mix","tracks":[{"videoId":"aaaaaaaaaaa","title":"One","artist":"A"}]}"""))
    assertEquals("mix", station.seedKey)
    assertEquals(1, station.tracks.size)
  }

  @Test fun endReasonsMatchThePhone() {
    assertEquals("completed", ListenRules.endReason(TrackEnd.FINISHED, 10.0, 200.0))
    assertEquals("skipped", ListenRules.endReason(TrackEnd.SKIPPED, 30.0, 200.0))
    assertEquals("completed", ListenRules.endReason(TrackEnd.SKIPPED, 195.0, 200.0))
    assertEquals("stopped", ListenRules.endReason(TrackEnd.REPLACED, 30.0, 200.0))
    assertEquals("completed", ListenRules.endReason(TrackEnd.REPLACED, 193.0, 200.0))
    assertEquals("stopped", ListenRules.endReason(TrackEnd.REPLACED, 30.0, 0.0))
  }

  @Test fun playsAreClampedAndUnstartedSongsAreNotListens() {
    val play = ListenRules.play("aaaaaaaaaaa", "2026-11-15T10:00:00.000Z", 250.4, 200.2, "completed", "mix")!!
    assertEquals(200, play.getInt("listenedSeconds"))
    assertEquals(200, play.getInt("duration"))
    assertEquals("completed", play.getString("endReason"))
    assertEquals("mix", play.getString("stationSeed"))
    assertNull(ListenRules.play("aaaaaaaaaaa", "2026-11-15T10:00:00.000Z", 0.2, 200.0, "skipped", null))
    val noSeed = ListenRules.play("aaaaaaaaaaa", "2026-11-15T10:00:00.000Z", 0.0, 200.0, "completed", null)!!
    assertEquals(true, noSeed.isNull("stationSeed"))
  }

  @Test fun voicePrefersASongThenAnAlbumThenAnArtist() {
    val track = CatalogTrack("aaaaaaaaaaa", "One", "A", null, null)
    val album = CatalogAlbum("MPREb_1", "Album", "A", null)
    val artist = CatalogArtist("UC1", "A", null)
    assertEquals(StationSeed("track", "aaaaaaaaaaa"), ListenRules.voiceSeed(CatalogSearch(listOf(track), listOf(album), listOf(artist))))
    assertEquals(StationSeed("album", "MPREb_1"), ListenRules.voiceSeed(CatalogSearch(emptyList(), listOf(album), listOf(artist))))
    assertEquals(StationSeed("artist", "UC1"), ListenRules.voiceSeed(CatalogSearch(emptyList(), emptyList(), listOf(artist))))
    assertNull(ListenRules.voiceSeed(CatalogSearch(emptyList(), emptyList(), emptyList())))
  }

  @Test fun anArtistsRadioIsItsOwnSeed() {
    val radio = StationSeed("artist", "UC1", radio = true)
    assertEquals(radio, CatalogIds.seedFor(CatalogIds.artistRadio("UC1")))
    assertEquals(StationSeed("artist", "UC1"), CatalogIds.seedFor(CatalogIds.artist("UC1")))
    assertEquals(true, radio.toJson().getBoolean("radio"))
    assertEquals(false, StationSeed("artist", "UC1").toJson().has("radio"))
    assertEquals(radio, ListenRules.radioSeed(CatalogSearch(emptyList(), emptyList(), listOf(CatalogArtist("UC1", "A", null)))))
  }

  @Test fun spokenRadioRequestsNameTheArtist() {
    assertEquals("Radiohead", ListenRules.radioArtistQuery("Radiohead radio"))
    assertEquals("the beatles", ListenRules.radioArtistQuery("the beatles Station "))
    assertNull(ListenRules.radioArtistQuery("Radiohead"))
    assertNull(ListenRules.radioArtistQuery("radio"))
    assertNull(ListenRules.radioArtistQuery("Video Killed the Radio Star"))
  }

  @Test fun audioAddressesNameTheirServer() {
    assertEquals("https://tube.example", MusicServer.instanceOf("https://tube.example/api/music/tracks/aaaaaaaaaaa/audio"))
    assertEquals("http://192.168.1.5:8080/sub", MusicServer.instanceOf("http://192.168.1.5:8080/sub/api/music/tracks/aaaaaaaaaaa/audio"))
    assertNull(MusicServer.instanceOf("https://tube.example/api/video/aaaaaaaaaaa"))
    // Downloaded songs play from files and name no server.
    assertNull(MusicServer.instanceOf("file:///data/user/0/app.ytzero.tv/files/music/aaaaaaaaaaa.m4a"))
    assertNull(MusicServer.instanceOf("file:///x/api/music/tracks/aaaaaaaaaaa/audio"))
  }
}
