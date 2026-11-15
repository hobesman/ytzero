// Runs the Alexa video skill's catalog queries against a throwaway database and
// reports what they return and record. See src/alexa/alexaVideoCatalog.test.ts.
const { db } = await import("../src/db");
const catalog = await import("../src/alexa/alexaVideoCatalog");

const user = 1;
db.prepare("INSERT INTO channels(channel_id,title,url,custom_title) VALUES('UCfollowed','Raw Name','https://youtube.com/channel/UCfollowed','This Old House')").run();
db.prepare("INSERT INTO channels(channel_id,title,url) VALUES('UCunfollowed','Unfollowed','https://youtube.com/channel/UCunfollowed')").run();
db.prepare("INSERT INTO user_channels(user_id,channel_id,followed) VALUES(?,?,1)").run(user, "UCfollowed");
db.prepare("INSERT INTO user_channels(user_id,channel_id,followed) VALUES(?,?,0)").run(user, "UCunfollowed");

const insertVideo = db.prepare("INSERT INTO videos(video_id,channel_id,title,published_at,duration,live_status,members_only,is_short) VALUES(?,?,?,?,?,?,?,?)");
insertVideo.run("oldVideo001", "UCfollowed", "Old episode", "2024-01-01T00:00:00Z", "10:00", "none", 0, 0);
insertVideo.run("newVideo001", "UCfollowed", "New episode", "2026-11-01T00:00:00Z", "1:00:00", "none", 0, 0);
insertVideo.run("liveVideo01", "UCfollowed", "Live now", "2026-11-10T00:00:00Z", null, "live", 0, 0);
insertVideo.run("membersVid1", "UCfollowed", "Members", "2026-11-09T00:00:00Z", "5:00", "none", 1, 0);
insertVideo.run("shortVideo1", "UCfollowed", "A short", "2026-11-08T00:00:00Z", "0:30", "none", 0, 1);
db.prepare("INSERT INTO user_videos(user_id,video_id,watch_position,watch_duration) VALUES(?,?,?,?)").run(user, "newVideo001", 1200, 3600);
db.prepare("INSERT INTO user_videos(user_id,video_id,watch_position,watch_duration) VALUES(?,?,?,?)").run(user, "oldVideo001", 10, 600);

const followed = await catalog.followedChannels(user);
const videos = await catalog.channelVideos(user, "UCfollowed");
const newest = await catalog.alexaVideo(user, "newVideo001");
const missing = await catalog.alexaVideo(user, "nothing0001");

await catalog.recordVideoStarted(user, "oldVideo001");
await catalog.recordVideoProgress(user, "oldVideo001", 300, null);
const progress = db.prepare("SELECT watch_position, watch_duration, watched FROM user_videos WHERE user_id=? AND video_id=?").get(user, "oldVideo001");
await catalog.recordVideoFinished(user, "oldVideo001");
const finished = db.prepare("SELECT watched FROM user_videos WHERE user_id=? AND video_id=?").get(user, "oldVideo001");
const history = (db.prepare("SELECT COUNT(*) AS n FROM history WHERE user_id=? AND video_id=?").get(user, "oldVideo001") as { n: number }).n;
const subscriptions = db.prepare("SELECT channel_id, followed FROM user_channels WHERE user_id=? ORDER BY channel_id").all(user);

console.log(`RESULT ${JSON.stringify({ followed, videos, newest, missing, progress, finished, history, subscriptions })}`);
process.exit(0);
