import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-music-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const child = Bun.spawn([process.execPath, "app/tests/musicHarness.ts"], {
    cwd: resolve(import.meta.dir, "../../.."),
    env: { ...Bun.env, DB_PATH: resolve(root, "db", "source.db"), AVATAR_DIR: resolve(root, "avatars"), DOWNLOADS_DIR: resolve(root, "downloads") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Music harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Music harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
}, 120_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("music mode", () => {
  test("never touches the video catalog, history, progress, subscriptions or recommendations", () => {
    expect(result.after).toEqual(result.before);
  });

  test("talks to YouTube Music, not the video watch or info pages", () => {
    expect(result.youtubeRequests.length).toBeGreaterThan(0);
    for (const url of result.youtubeRequests) expect(url).toStartWith("https://music.youtube.com/");
  });

  test("searches and starts a station with its seed song", () => {
    expect(result.searchIds).toEqual(["seedSong001"]);
    expect(result.startStatus).toBe(200);
    expect(result.served).toHaveLength(5);
    expect(result.served[0]).toBe("seedSong001");
    expect(new Set(result.served).size).toBe(5);
  });

  test("passes each song's loudness, learning the station's first song before answering", () => {
    expect(result.stationLoudness[0]).toBe(3.5);
    expect(result.stationLoudness.slice(1)).toEqual([null, null, null, null]);
    expect(result.preparedLoudness).toBe(3.5);
    for (const url of result.loudnessRequests) expect(url).toStartWith("https://www.youtube.com/youtubei/v1/player");
    expect(result.loudnessRequests.length).toBeGreaterThan(0);
  });

  test("serves a prepared song's first bytes without asking the audio host again", () => {
    expect(result.prepared).toBe(true);
    expect(result.stationPreparedFirst).toBe(true);
    expect(result.preparedStatus).toBe(206);
    expect(result.preparedRange).toBe("bytes 0-1023/500000");
    expect(result.preparedFromMemory).toBe(true);
    expect(result.preparedOpenRange).toBe("bytes 0-499999/500000");
    expect(result.preparedOpenLength).toBe(500000);
    expect(result.headStatus).toBe(200);
    expect(result.unknownAudioStatus).toBe(404);
  });

  test("records plays and ratings idempotently and validates them", () => {
    expect(result.playStatus).toBe(200);
    expect(result.replayStatus).toBe(200);
    expect(result.musicPlays).toBe(2);
    expect(result.invalidPlayStatus).toBe(400);
    expect(result.likeStatus).toBe(200);
    expect(result.invalidRatingStatus).toBe(400);
    expect(result.invalidSeedStatus).toBe(400);
  });

  test("continues a station without repeats or not-this-one songs", () => {
    expect(result.nextStatus).toBe(200);
    expect(result.nextIds.length).toBeGreaterThan(0);
    for (const id of result.nextIds) expect(result.served).not.toContain(id);
    // The liked-songs station draws on the liked song's radio; the liked song
    // itself was just played, so fresher songs come first.
    expect(result.likedStationIds).toHaveLength(3);
    expect(result.likedStationIds).not.toContain(result.served[0]);
    expect(result.likedStationIds).not.toContain(result.served[2]);
  });

  test("keeps each profile's music library its own", () => {
    expect(result.likedIds).toEqual([result.served[0]]);
    expect(result.firstRating).toBe(1);
    expect(result.recentIds).toEqual([result.served[1], result.served[0]]);
    expect(result.otherLibrary).toEqual({ liked: [], recent: [], albums: [], playlists: [], savedPlaylists: [] });
  });

  test("is not available to child profiles", () => {
    expect(result.childSearchStatus).toBe(403);
    expect(result.childStationStatus).toBe(403);
  });

  test("plays an album from a chosen track, then continues with a station without album repeats", () => {
    expect(result.albumStatus).toBe(200);
    expect(result.albumTitle).toBe("Abbey Road (2019 Mix)");
    expect(result.albumIds).toHaveLength(17);
    expect(result.albumSavedBefore).toBe(false);
    expect(result.albumStartIds).toEqual(result.albumIds.slice(2));
    expect(result.albumStartSeed).toBe("album:MPREb_LQwx7Jq6u9H");
    expect(result.albumNextIds.length).toBeGreaterThan(0);
    for (const id of result.albumNextIds) expect(result.albumIds.slice(2)).not.toContain(id);
  });

  test("browses Moods & genres and plays a playlist shuffled, then a station after it", () => {
    expect(result.genreCount).toBe(40);
    expect(result.decadesShelves).toContain("1980s");
    expect(result.playlistTitle).toBe("The Hits: '80s");
    expect(result.playlistIds).toHaveLength(5);
    expect(result.playlistStartSeed).toBe("playlist:RDCLAK5uy_lMzHW51iFg1Kx0d_2EHpzbOgCrwtu8cgI");
    expect(result.playlistStartIds).toHaveLength(3);
    for (const id of result.playlistStartIds) expect(result.playlistIds).toContain(id);
    expect(result.playlistAfterIds.length).toBeGreaterThan(0);
    for (const id of result.playlistAfterIds) expect(result.playlistIds).not.toContain(id);
    expect(result.badPlaylistStatus).toBe(404);
    expect(result.childGenresStatus).toBe(403);
  });

  test("looks up a known song's lyrics by its details alone, and never for a child profile", () => {
    expect(result.childLyricsStatus).toBe(403);
    expect(result.unknownLyricsStatus).toBe(404);
    expect(result.lyrics).toEqual({ videoId: "seedSong001", synced: [{ time: 1, text: "A line" }, { time: 4.5, text: "Another" }], plain: null, instrumental: false, source: "LRCLIB" });
    expect(result.lrclibUrls).toHaveLength(1);
    const params = Object.fromEntries(new URL(result.lrclibUrls[0]).searchParams);
    expect(Object.keys(params).sort()).toEqual(expect.arrayContaining(["artist_name", "track_name"]));
    for (const key of Object.keys(params)) expect(["artist_name", "track_name", "album_name", "duration"]).toContain(key);
  });

  test("saves albums per profile and unsaves them", () => {
    expect(result.saveStatus).toBe(200);
    expect(result.savedFlag).toBe(true);
    expect(result.librarySavedIds).toEqual(["MPREb_LQwx7Jq6u9H"]);
    expect(result.librarySavedTitle).toBe("Abbey Road (2019 Mix)");
    expect(result.libraryUnsaved).toEqual([]);
    expect(result.otherSaved).toEqual([]);
  });

  test("shows artist pages, starts artist stations, and searches albums and artists with songs", () => {
    expect(result.artistStatus).toBe(200);
    expect(result.artistName).toBe("The Beatles");
    expect(result.artistAlbums).toBeGreaterThan(0);
    expect(result.artistStationIds.length).toBeGreaterThan(0);
    expect(result.artistStationIds.some((id: string) => result.artistTopIds.includes(id))).toBe(true);
    expect(result.badAlbumStatus).toBe(404);
    expect(result.childAlbumStatus).toBe(403);
    expect(result.mixedAlbums[0]).toBe("MPREb_LQwx7Jq6u9H");
    expect(result.mixedArtists).toBeGreaterThan(0);
    expect(result.mixedTracks).toBeGreaterThan(0);
  });

  test("round-trips through backup, restores idempotently, and replaces on request", () => {
    expect(result.exported.ratings).toHaveLength(2);
    expect(result.exported.plays).toHaveLength(2);
    expect(result.exported.saved_albums.map((album: any) => album.browse_id)).toEqual(["MPREb_LQwx7Jq6u9H"]);
    expect(result.exported.playlists.map((playlist: any) => [playlist.title, playlist.tracks])).toEqual([["Road trip 2", [result.served[2], result.served[1]]]]);
    expect(result.exported.saved_playlists.map((playlist: any) => playlist.playlist_id)).toEqual([result.playlistStartSeed.slice("playlist:".length)]);
    expect(result.exported.echo_plays.map((play: any) => [play.song_key, play.title, play.end_reason])).toEqual([["obscure band|deep cut", "Deep Cut", "skipped"]]);
    expect(result.restoredV1).toEqual({ ...result.exported, saved_albums: [], playlists: [], saved_playlists: [], echo_plays: [] });
    expect(result.exported.tracks.map((track: any) => track.video_id).sort()).toEqual([result.served[0], result.served[1], result.served[2]].sort());
    // The copy restored into another profile keeps everything but the playlist IDs, which are made its own.
    expect(withoutPlaylistIds(result.restoredTwice)).toEqual(withoutPlaylistIds(result.exported));
    expect(result.restoredTwice.playlists).toHaveLength(1);
    expect(result.restoredTwice.playlists[0].id).not.toBe(result.exported.playlists[0].id);
    expect(withoutPlaylistIds(result.replaced)).toEqual(withoutPlaylistIds(result.exported));
    expect(result.replaced.playlists[0].id).toBe(result.restoredTwice.playlists[0].id);
    expect(result.malformedSkipped).toBe(7);
  });

  test("shows an Echo song with no YouTube Music track in Recently played, greyed out, for its own profile only", () => {
    expect(result.echoRecentFirst).toEqual({
      videoId: "echo:obscure band|deep cut", title: "Deep Cut", artist: "Obscure Band", artistId: null, album: "B-Sides", duration: 200,
      thumbnail: "https://m.media-amazon.com/x.jpg", isTopic: false, rating: 0, playable: false,
    });
    expect(result.echoRecentLength).toBe(result.recentLengthBeforeEcho + 1);
    expect(result.echoRecentOther).toBe(0);
  });

  test("keeps a profile's own playlists: create, add, reorder, remove, rename and delete", () => {
    expect(result.createdStatus).toBe(201);
    expect(result.createdTitle).toBe("Road trip");
    expect(result.emptyTitleStatus).toBe(400);
    expect(result.addAgain).toEqual({ ok: true, added: false });
    expect(result.unseenSongStatus).toBe(404);
    expect(result.reorderStatus).toBe(200);
    expect(result.staleOrderStatus).toBe(409);
    expect(result.renameStatus).toBe(200);
    expect(result.minePage).toEqual({ title: "Road trip 2", trackCount: 2, ids: [result.served[2], result.served[1]], thumbnail: expect.stringContaining(result.served[2]) });
    expect(result.bulkAdd).toEqual({ ok: true, added: 2, present: 1, full: 0, unknown: 1 });
    expect(result.bulkIds).toEqual([result.served[1], result.served[3], result.served[2]]);
    expect(result.bulkEmptyStatus).toBe(400);
    expect(result.bulkOtherStatus).toBe(404);
    expect(result.deletePlaylistStatus).toBe(200);
    expect(result.doomedTracksLeft).toBe(0);
    expect(result.libraryPlaylists).toEqual(["Road trip 2"]);
  });

  test("keeps playlists per profile and away from child profiles", () => {
    expect(result.otherReadStatus).toBe(404);
    expect(result.otherAddStatus).toBe(404);
    expect(result.otherDeleteStatus).toBe(404);
    expect(result.childPlaylistsStatus).toBe(403);
  });

  test("saves a YouTube Music playlist to the library", () => {
    expect(result.playlistSavedBefore).toBe(false);
    expect(result.playlistSaveStatus).toBe(200);
    expect(result.playlistSavedAfter).toBe(true);
    expect(result.librarySavedPlaylists).toEqual([`${result.playlistStartSeed.slice("playlist:".length)} The Hits: '80s`]);
  });
});

function withoutPlaylistIds(doc: any) {
  return { ...doc, playlists: doc.playlists.map(({ id: _id, ...playlist }: any) => playlist) };
}
