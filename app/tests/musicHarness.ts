// Drives every music route against a throwaway database, with YouTube and the
// audio host stubbed, and reports what changed. See src/music/musicIsolation.test.ts.
import { Hono } from "hono";

const { db } = await import("../src/db");
const { registerMusicRoutes } = await import("../src/routes/musicRoutes");
const { createYouTubeMusicClient } = await import("../src/music/youtubeMusicClient");
const { createMusicAudio } = await import("../src/music/musicAudio");
const { exportMusicBackup, restoreMusicBackup } = await import("../src/music/musicBackup");

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
const fakeFetch = async (url: string, init?: RequestInit) => {
  youtubeRequests.push(url);
  if (init?.method !== "POST") return new Response('<script>{"INNERTUBE_CLIENT_VERSION":"1.2026"}</script>');
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
registerMusicRoutes(api, {
  currentUserId: (context) => context.get("userId"),
  client: createYouTubeMusicClient({ fetch: fakeFetch }),
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
const prepareResponse = await call(`/music/tracks/${served[1]}/prepare`, "POST");
const prepared = await prepareResponse.json() as any;
const callsAfterPrepare = audioCalls.length;
const preparedAudio = await call(`/music/tracks/${served[1]}/audio`, "GET", undefined, 1, { Range: "bytes=0-" });
const preparedFromMemory = audioCalls.length === callsAfterPrepare;
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

const after = counts();

// Backup round trip into another profile: merge twice, then replace.
const exported = await exportMusicBackup(1);
await restoreMusicBackup(secondary.id, exported, "merge");
await restoreMusicBackup(secondary.id, exported, "merge");
const restoredTwice = await exportMusicBackup(secondary.id);
await call(`/music/tracks/${served[3]}/rating`, "PUT", { rating: 1 }, secondary.id);
await restoreMusicBackup(secondary.id, exported, "replace");
const replaced = await exportMusicBackup(secondary.id);
const malformed = await restoreMusicBackup(secondary.id, { ratings: [{ video_id: "x", rating: 1 }], plays: [{ video_id: served[0], started_at: "never" }] }, "merge");

console.log("RESULT " + JSON.stringify({
  before, after,
  youtubeRequests,
  searchIds: search.tracks.map((track: any) => track.videoId),
  startStatus: startResponse.status,
  served,
  prepared: prepared.ready,
  preparedStatus: preparedAudio.status,
  preparedRange: preparedAudio.headers.get("content-range"),
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
}));

db.close();
