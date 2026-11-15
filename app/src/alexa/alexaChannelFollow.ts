import { publishAppEventForUser } from "../appEvents";
import { database } from "../database";
import { log } from "../logger";
import type { ChannelCandidate } from "./alexaChannelDialog";

/**
 * Following and unfollowing for the Alexa skill, the same writes as the app's
 * follow button (`PUT /api/channels/:id/follow`). Unfollowing keeps the
 * profile's per-channel settings by setting `followed = 0`.
 */
export async function followChannelForAlexa(userId: number, channel: ChannelCandidate): Promise<void> {
  const existing = await database.prepare("SELECT 1 FROM channels WHERE channel_id = ?").get(channel.channelId);
  if (!existing) {
    const { resolveChannelId } = await import("../youtube");
    const info = await resolveChannelId(channel.channelId, userId);
    if (info.channelId !== channel.channelId) throw new Error("channel id mismatch");
    await database.prepare("INSERT OR IGNORE INTO channels (channel_id, title, url, thumbnail) VALUES (?, ?, ?, ?)")
      .run(info.channelId, info.title, `https://www.youtube.com/channel/${info.channelId}`, info.thumbnail);
  }
  await database.prepare(`
    INSERT INTO user_channels (user_id, channel_id, followed) VALUES (?, ?, 1)
    ON CONFLICT(user_id, channel_id) DO UPDATE SET followed = 1
  `).run(userId, channel.channelId);
  await database.prepare("UPDATE channels SET external = 0 WHERE channel_id = ?").run(channel.channelId);
  publishAppEventForUser("live", userId);
  log.info("alexa.channel_followed", { channelId: channel.channelId, title: channel.title, userId });
  const { refreshChannel, refreshLiveStatus } = await import("../refresher");
  refreshChannel(channel.channelId, userId)
    .then(() => refreshLiveStatus(channel.channelId, { userId }))
    .catch((error) => log.error("channel.initial_refresh_failed", { channelId: channel.channelId, error: error instanceof Error ? error.message : String(error) }));
}

export async function unfollowChannelForAlexa(userId: number, channelId: string): Promise<void> {
  await database.prepare("UPDATE user_channels SET followed = 0 WHERE user_id = ? AND channel_id = ?").run(userId, channelId);
  publishAppEventForUser("live", userId);
  log.info("alexa.channel_unfollowed", { channelId, userId });
}

/** YouTube's channel matches for a spoken name, best first. */
export async function searchChannelsForAlexa(userId: number, query: string): Promise<ChannelCandidate[]> {
  const { searchYouTube } = await import("../youtube");
  const { channels } = await searchYouTube(query, userId);
  return channels.map((channel) => ({ channelId: channel.channelId, title: channel.title, subscribers: channel.subscriberCount }));
}
