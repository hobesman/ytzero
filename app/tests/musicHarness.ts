// Drives every music route against a throwaway database, with YouTube and the
// audio host stubbed, and reports what changed. See src/music/musicIsolation.test.ts.
import { Hono } from "hono";

const { db } = await import("../src/db");
const { registerMusicRoutes } = await import("../src/routes/musicRoutes");
const { createYouTubeMusicClient } = await import("../src/music/youtubeMusicClient");
const { createMusicAudio } = await import("../src/music/musicAudio");
const { exportMusicBackup, restoreMusicBackup } = await import("../src/music/musicBackup");
const { createMusicLyrics } = await import("../src/music/musicLyrics");
const { createLrclibClient } = await import("../src/music/lrclib");

// Some video-mode state already exists, as on a real server.
db.prepare("INSERT INTO channels(channel_id,title,url) VALUES('UCvideo','Video channel','https://youtube.com/channel/UCvideo')").run();
db.prepare("INSERT INTO videos(video_id,channel_id,title) VALUES('videoAAAAA1','UCvideo','A video')").run();
db.prepare("INSERT INTO user_videos(user_id,video_id,watch_position,watch_duration) VALUES(1,'videoAAAAA1',30,100)").run();
db.prepare("INSERT INTO history(user_id,video_id,watched_at) VALUES(1,'videoAAAAA1','2026-11-01 10:00:00')").run();
const child = db.prepare("INSERT INTO users(name,avatar_color,sort_order,portable_uuid,is_child) VALUES('Child','#123456',1,?,1) RETURNING id")
  .get(crypto.randomUUID()) as { id: number };
const secondary = db.prepare("INSERT INTO users(name,avatar_color,sort_order,portable_uuid) VALUES('Second','#654321',2,?) RETURNING id")
  .get(crypto.randomUUID()) as { id: number };

const VIDEO_TABLES = [
  "channels", "videos", "user_videos", "user_channels", "history", "watch_time_log", "watch_tag_time_log",
  "scheduling_event_log", "sponsorblock_skip_log", "recommendation_feedback", "discovery_recommendations",
  "bookmarks", "downloads", "notifications", "social_posts",
];
const counts = () => Object.fromEntries(VIDEO_TABLES.map((table) => [table, (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n]));
const before = counts();

const artist = (name: string) => ({
  text: name,
  navigationEndpoint: { browseEndpoint: { browseId: `UC${name}`, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ARTIST" } } } },
});
const panel = (videoId: string, name: string) => ({ playlistPanelVideoRenderer: {
  videoId, title: { runs: [{ text: `Song ${videoId}` }] }, lengthText: { runs: [{ text: "3:00" }] },
  longBylineText: { runs: [artist(name)] }, thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${videoId}/hq.jpg`, width: 480 }] },
  navigationEndpoint: { watchEndpoint: { videoId, watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: "MUSIC_VIDEO_TYPE_ATV" } } } },
} });
const radioIds = ["seedSong001", ...Array.from({ length: 12 }, (_, index) => `radioSong${String(index + 1).padStart(2, "0")}`)];
const youtubeRequests: string[] = [];
// Album, artist and mixed-search answers are real (trimmed) YouTube Music responses.
const fixture = async (name: string) => JSON.parse(await Bun.file(new URL(`../src/music/fixtures/ytm-${name}.json`, import.meta.url)).text());
const [albumFixture, artistFixture, searchFixture, moodsFixture, decadesFixture, playlistFixture] = await Promise.all(
  ["album", "artist", "search", "moods", "genre-decades", "playlist"].map(fixture),
);
const browseFixture = (browseId: string) => browseId === "FEmusic_moods_and_genres" ? moodsFixture
  : browseId === "FEmusic_moods_and_genres_category" ? decadesFixture
  : browseId.startsWith("VL") ? playlistFixture
  : browseId.startsWith("MPREb_") ? albumFixture : artistFixture;
const fakeFetch = async (url: string, init?: RequestInit) => {
  youtubeRequests.push(url);
  if (init?.method !== "POST") return new Response('<script>{"INNERTUBE_CLIENT_VERSION":"1.2026"}</script>');
  const request = JSON.parse(String(init.body ?? "{}"));
  if (url.includes("/browse")) return Response.json(browseFixture(String(request.browseId)));
  if (url.includes("/search") && !request.params) return Response.json(searchFixture);
  if (url.includes("/search")) {
    return Response.json({ contents: [{ musicResponsiveListItemRenderer: {
      playlistItemData: { videoId: "seedSong001" },
      flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Song seedSong001" }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [artist("Seed")] } } }],
    } }] });
  }
  return Response.json({ contents: { playlistPanelRenderer: {
    contents: radioIds.map((id, index) => panel(id, index === 0 ? "Seed" : `Artist${index % 6}`)),
  } } });
};

const total = 500_000;
const audioCalls: string[] = [];
const getAudioResponse = async (_userId: number, videoId: string, range: string | null) => {
  audioCalls.push(`${videoId} ${range}`);
  const match = range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = Number(match?.[1] ?? 0);
  const end = Math.min(match?.[2] ? Number(match[2]) : total - 1, total - 1);
  return new Response(new Uint8Array(end - start + 1), { status: 206, headers: { "Content-Type": "audio/webm", "Content-Range": `bytes ${start}-${end}/${total}` } });
};
const getAudioHeadResponse = async () => new Response(null, { status: 200, headers: { "Content-Length": String(total) } });

const api = new Hono<{ Variables: { userId: number } }>();
api.use("*", async (context, next) => {
  context.set("userId", Number(context.req.header("x-profile") ?? 1));
  await next();
});
// LRCLIB is stubbed too, and records what it was asked.
const lrclibUrls: string[] = [];
const lrclib = createLrclibClient({ fetch: async (url) => {
  lrclibUrls.push(url);
  return url.includes("/api/get") ? Response.json({ duration: 200, syncedLyrics: "[00:01.00] A line\n[00:04.50] Another" }) : Response.json([]);
} });
const client = createYouTubeMusicClient({ fetch: fakeFetch });
registerMusicRoutes(api, {
  currentUserId: (context) => context.get("userId"),
  client,
  lyrics: createMusicLyrics({ client, lrclib }),
  audio: createMusicAudio({ getAudioResponse, getAudioHeadResponse }),
});

const call = (path: string, method = "GET", body?: unknown, profile = 1, headers: Record<string, string> = {}) => api.request(`http://localhost${path}`, {
  method,
  headers: { "x-profile": String(profile), "Content-Type": "application/json", ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const search = await (await call("/music/search?q=seed")).json() as any;
const startResponse = await call("/music/station", "POST", { seed: { kind: "track", videoId: "seedSong001" }, count: 5 });
const start = await startResponse.json() as any;
const served = start.tracks.map((track: any) => track.videoId);
// Starting a station prepares its first song in the background.
await Bun.sleep(20);
const stationPreparedFirst = audioCalls.includes(`${served[0]} bytes=0-262143`);
const prepareResponse = await call(`/music/tracks/${served[1]}/prepare`, "POST");
const prepared = await prepareResponse.json() as any;
const callsAfterPrepare = audioCalls.length;
const preparedAudio = await call(`/music/tracks/${served[1]}/audio`, "GET", undefined, 1, { Range: "bytes=0-1023" });
const preparedFromMemory = audioCalls.length === callsAfterPrepare;
// The player's open request gets the whole song, the prepared prefix first.
const preparedOpen = await call(`/music/tracks/${served[1]}/audio`, "GET", undefined, 1, { Range: "bytes=0-" });
const preparedOpenLength = (await preparedOpen.arrayBuffer()).byteLength;
const headResponse = await call(`/music/tracks/${served[0]}/audio`, "HEAD");
const unknownAudio = await call("/music/tracks/videoAAAAA1/audio");
const playResponse = await call("/music/plays", "POST", { videoId: served[0], startedAt: "2026-11-13T10:00:00.000Z", listenedSeconds: 180, duration: 180, endReason: "completed", stationSeed: start.seed });
await call("/music/plays", "POST", { videoId: served[1], startedAt: "2026-11-13T10:03:00.000Z", listenedSeconds: 4, duration: 180, endReason: "skipped" });
const replayResponse = await call("/music/plays", "POST", { videoId: served[0], startedAt: "2026-11-13T10:00:00.000Z", listenedSeconds: 180, duration: 180, endReason: "completed" });
const invalidPlay = await call("/music/plays", "POST", { videoId: served[0], startedAt: "yesterday", listenedSeconds: 1, endReason: "completed" });
const likeResponse = await call(`/music/tracks/${served[0]}/rating`, "PUT", { rating: 1 });
await call(`/music/tracks/${served[2]}/rating`, "PUT", { rating: -1 });
const invalidRating = await call(`/music/tracks/${served[0]}/rating`, "PUT", { rating: 5 });
const nextResponse = await call("/music/station", "POST", { seed: { kind: "track", videoId: "seedSong001" }, served, skipped: [served[1]], count: 5 });
const next = await nextResponse.json() as any;
const likedStation = await (await call("/music/station", "POST", { seed: { kind: "liked" }, count: 3 })).json() as any;
const invalidSeed = await call("/music/station", "POST", { seed: { kind: "track", videoId: "nope" } });
const library = await (await call("/music/library")).json() as any;
const otherLibrary = await (await call("/music/library", "GET", undefined, secondary.id)).json() as any;
const childSearch = await call("/music/search?q=seed", "GET", undefined, child.id);
const childStation = await call("/music/station", "POST", { seed: { kind: "liked" } }, child.id);

// Albums and artists.
const ALBUM = "MPREb_LQwx7Jq6u9H";
const ARTIST = "UC2XdaAVUannpujzv32jcouQ";
const albumResponse = await call(`/music/albums/${ALBUM}`);
const album = await albumResponse.json() as any;
const albumIds: string[] = album.tracks.map((track: any) => track.videoId);
const albumStart = await (await call("/music/station", "POST", { seed: { kind: "album", browseId: ALBUM, startAt: albumIds[2] }, count: 5 })).json() as any;
const albumNext = await (await call("/music/station", "POST", { seed: { kind: "album", browseId: ALBUM, startAt: albumIds[2] }, served: albumIds.slice(2), count: 5 })).json() as any;
const saveResponse = await call(`/music/albums/${ALBUM}/saved`, "PUT");
const savedFlag = (await (await call(`/music/albums/${ALBUM}`)).json() as any).saved;
const librarySaved = (await (await call("/music/library")).json() as any).albums;
await call(`/music/albums/${ALBUM}/saved`, "DELETE");
const libraryUnsaved = (await (await call("/music/library")).json() as any).albums;
await call(`/music/albums/${ALBUM}/saved`, "PUT");
const otherSaved = (await (await call("/music/library", "GET", undefined, secondary.id)).json() as any).albums;
const artistResponse = await call(`/music/artists/${ARTIST}`);
const artistPage = await artistResponse.json() as any;
const artistStation = await (await call("/music/station", "POST", { seed: { kind: "artist", artistId: ARTIST }, count: 5 })).json() as any;
const badAlbumStatus = (await call("/music/albums/nope")).status;
const childAlbumStatus = (await call(`/music/albums/${ALBUM}`, "GET", undefined, child.id)).status;
const mixedSearch = await (await call("/music/search?q=abbey")).json() as any;
const genreList = (await (await call("/music/genres")).json() as any).genres;
const decades = genreList.find((genre: any) => genre.title === "Decades");
const decadesPage = await (await call(`/music/genres/${decades.id}`)).json() as any;
const PLAYLIST = decadesPage.shelves[3].playlists[0].playlistId;
const playlistPage = await (await call(`/music/playlists/${PLAYLIST}`)).json() as any;
const playlistIds: string[] = playlistPage.tracks.map((track: any) => track.videoId);
const playlistStart = await (await call("/music/station", "POST", { seed: { kind: "playlist", playlistId: PLAYLIST }, count: 3 })).json() as any;
const playlistAfter = await (await call("/music/station", "POST", { seed: { kind: "playlist", playlistId: PLAYLIST }, served: playlistIds, count: 3 })).json() as any;
const badPlaylistStatus = (await call("/music/playlists/nope")).status;
const childGenresStatus = (await call("/music/genres", "GET", undefined, child.id)).status;
const childLyricsStatus = (await call("/music/tracks/seedSong001/lyrics", "GET", undefined, child.id)).status;
const unknownLyricsStatus = (await call("/music/tracks/unknownSong/lyrics")).status;
const lyrics = await (await call("/music/tracks/seedSong001/lyrics")).json();

// A profile's own playlists, and saving a YouTube Music playlist.
const createdResponse = await call("/music/my-playlists", "POST", { title: "  Road \n trip " });
const mine = (await createdResponse.json() as any).playlist;
const emptyTitleStatus = (await call("/music/my-playlists", "POST", { title: "   " })).status;
for (const videoId of served.slice(0, 3)) await call(`/music/my-playlists/${mine.id}/tracks`, "POST", { videoId });
const addAgain = await (await call(`/music/my-playlists/${mine.id}/tracks`, "POST", { videoId: served[0] })).json() as any;
const unseenSongStatus = (await call(`/music/my-playlists/${mine.id}/tracks`, "POST", { videoId: "videoAAAAA1" })).status;
const reorderStatus = (await call(`/music/my-playlists/${mine.id}/order`, "PUT", { videoIds: [served[2], served[0], served[1]] })).status;
const staleOrderStatus = (await call(`/music/my-playlists/${mine.id}/order`, "PUT", { videoIds: [served[0]] })).status;
await call(`/music/my-playlists/${mine.id}/tracks/${served[0]}`, "DELETE");
const renameStatus = (await call(`/music/my-playlists/${mine.id}`, "PATCH", { title: "Road trip 2" })).status;
const minePage = await (await call(`/music/my-playlists/${mine.id}`)).json() as any;
const otherReadStatus = (await call(`/music/my-playlists/${mine.id}`, "GET", undefined, secondary.id)).status;
const otherAddStatus = (await call(`/music/my-playlists/${mine.id}/tracks`, "POST", { videoId: served[3] }, secondary.id)).status;
const otherDeleteStatus = (await call(`/music/my-playlists/${mine.id}`, "DELETE", undefined, secondary.id)).status;
const childPlaylistsStatus = (await call("/music/my-playlists", "GET", undefined, child.id)).status;
const doomed = (await (await call("/music/my-playlists", "POST", { title: "Doomed" })).json() as any).playlist;
await call(`/music/my-playlists/${doomed.id}/tracks`, "POST", { videoId: served[1] });
const deletePlaylistStatus = (await call(`/music/my-playlists/${doomed.id}`, "DELETE")).status;
const doomedTracksLeft = (db.prepare("SELECT COUNT(*) AS n FROM music_playlist_tracks WHERE playlist_id = ?").get(doomed.id) as { n: number }).n;
const playlistSavedBefore = playlistPage.saved;
const playlistSaveStatus = (await call(`/music/playlists/${PLAYLIST}/saved`, "PUT")).status;
const playlistSavedAfter = (await (await call(`/music/playlists/${PLAYLIST}`)).json() as any).saved;
const playlistLibrary = await (await call("/music/library")).json() as any;

const after = counts();

// Backup round trip into another profile: merge twice, then replace.
const exported = await exportMusicBackup(1);
await restoreMusicBackup(secondary.id, exported, "merge");
await restoreMusicBackup(secondary.id, exported, "merge");
const restoredTwice = await exportMusicBackup(secondary.id);
await call(`/music/tracks/${served[3]}/rating`, "PUT", { rating: 1 }, secondary.id);
await restoreMusicBackup(secondary.id, exported, "replace");
const replaced = await exportMusicBackup(secondary.id);
const malformed = await restoreMusicBackup(secondary.id, {
  ratings: [{ video_id: "x", rating: 1 }], plays: [{ video_id: served[0], started_at: "never" }], saved_albums: [{ browse_id: "VLnope" }],
  playlists: [{ id: "nope", title: "Bad" }, { id: crypto.randomUUID(), title: "  " }], saved_playlists: [{ playlist_id: "nope" }],
}, "merge");
// A schema v1 document, from before saved albums, restores into an empty profile.
const third = db.prepare("INSERT INTO users(name,avatar_color,sort_order,portable_uuid) VALUES('Third','#111111',3,?) RETURNING id")
  .get(crypto.randomUUID()) as { id: number };
const { saved_albums: _savedAlbums, playlists: _playlists, saved_playlists: _savedPlaylists, ...v1Document } = exported;
await restoreMusicBackup(third.id, v1Document, "merge");
const restoredV1 = await exportMusicBackup(third.id);

console.log("RESULT " + JSON.stringify({
  before, after,
  youtubeRequests,
  searchIds: search.tracks.map((track: any) => track.videoId),
  startStatus: startResponse.status,
  served,
  prepared: prepared.ready,
  stationPreparedFirst,
  preparedStatus: preparedAudio.status,
  preparedRange: preparedAudio.headers.get("content-range"),
  preparedOpenRange: preparedOpen.headers.get("content-range"),
  preparedOpenLength,
  preparedFromMemory,
  headStatus: headResponse.status,
  unknownAudioStatus: unknownAudio.status,
  playStatus: playResponse.status,
  replayStatus: replayResponse.status,
  invalidPlayStatus: invalidPlay.status,
  likeStatus: likeResponse.status,
  invalidRatingStatus: invalidRating.status,
  nextStatus: nextResponse.status,
  nextIds: next.tracks.map((track: any) => track.videoId),
  likedStationIds: likedStation.tracks.map((track: any) => track.videoId),
  invalidSeedStatus: invalidSeed.status,
  likedIds: library.liked.map((track: any) => track.videoId),
  recentIds: library.recent.map((track: any) => track.videoId),
  firstRating: library.liked[0]?.rating,
  otherLibrary,
  childSearchStatus: childSearch.status,
  childStationStatus: childStation.status,
  musicPlays: (db.prepare("SELECT COUNT(*) AS n FROM music_plays WHERE user_id = 1").get() as { n: number }).n,
  exported,
  restoredTwice,
  replaced,
  malformedSkipped: malformed.skipped,
  restoredV1,
  albumStatus: albumResponse.status,
  albumTitle: album.title,
  albumIds,
  albumSavedBefore: album.saved,
  albumStartIds: albumStart.tracks.map((track: any) => track.videoId),
  albumStartSeed: albumStart.seed,
  albumNextIds: albumNext.tracks.map((track: any) => track.videoId),
  saveStatus: saveResponse.status,
  savedFlag,
  librarySavedIds: librarySaved.map((saved: any) => saved.browseId),
  librarySavedTitle: librarySaved[0]?.title,
  libraryUnsaved,
  otherSaved,
  artistStatus: artistResponse.status,
  artistName: artistPage.name,
  artistAlbums: artistPage.albums.length,
  artistStationIds: artistStation.tracks.map((track: any) => track.videoId),
  artistTopIds: artistPage.topSongs.map((track: any) => track.videoId),
  badAlbumStatus,
  childAlbumStatus,
  mixedAlbums: mixedSearch.albums.map((item: any) => item.browseId),
  mixedArtists: mixedSearch.artists.length,
  mixedTracks: mixedSearch.tracks.length,
  genreCount: genreList.length,
  decadesShelves: decadesPage.shelves.map((shelf: any) => shelf.title),
  playlistTitle: playlistPage.title,
  playlistIds,
  playlistStartIds: playlistStart.tracks.map((track: any) => track.videoId),
  playlistStartSeed: playlistStart.seed,
  playlistAfterIds: playlistAfter.tracks.map((track: any) => track.videoId),
  badPlaylistStatus,
  childGenresStatus,
  childLyricsStatus,
  unknownLyricsStatus,
  lyrics,
  lrclibUrls,
  emptyTitleStatus,
  createdStatus: createdResponse.status,
  createdTitle: mine.title,
  addAgain,
  unseenSongStatus,
  reorderStatus,
  staleOrderStatus,
  renameStatus,
  minePage: { title: minePage.title, trackCount: minePage.trackCount, ids: minePage.tracks.map((track: any) => track.videoId), thumbnail: minePage.thumbnail },
  otherReadStatus,
  otherAddStatus,
  otherDeleteStatus,
  childPlaylistsStatus,
  deletePlaylistStatus,
  doomedTracksLeft,
  playlistSavedBefore,
  playlistSaveStatus,
  playlistSavedAfter,
  libraryPlaylists: playlistLibrary.playlists.map((playlist: any) => playlist.title),
  librarySavedPlaylists: playlistLibrary.savedPlaylists.map((playlist: any) => `${playlist.playlistId} ${playlist.title}`),
}));

db.close();
