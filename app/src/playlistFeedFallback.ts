import { database } from "./database";
import { log } from "./logger";
import { fetchPlaylistFeed, type PlaylistFeed } from "./youtube";

type StoredPlaylist = { channel_id: string; title: string; channel_title: string | null };

const storedPlaylist = (playlistId: string) => database.prepare(`
  SELECT p.channel_id, p.title, c.title AS channel_title
  FROM channel_playlists p LEFT JOIN channels c ON c.channel_id = p.channel_id
  WHERE p.playlist_id = ?
`).get<StoredPlaylist>(playlistId);

/**
 * A playlist's RSS feed, or, when YouTube has none for it (a 404 while the
 * playlist page itself works), what the instance already knows: the owning
 * channel and title stored with the playlist. The import then takes the
 * videos from the playlist page alone. A playlist never stored before, or any
 * other failure, still fails as before.
 */
export async function fetchPlaylistFeedOrStored(
  playlistId: string,
  force = false,
  userId?: number,
  dependencies: {
    fetchFeed?: typeof fetchPlaylistFeed;
    lookup?: (playlistId: string) => Promise<StoredPlaylist | null | undefined>;
  } = {},
): Promise<PlaylistFeed> {
  const { fetchFeed = fetchPlaylistFeed, lookup = storedPlaylist } = dependencies;
  try {
    return await fetchFeed(playlistId, force, userId);
  } catch (error) {
    if (!(error instanceof Error) || !/\(404\)$/.test(error.message)) throw error;
    const stored = await lookup(playlistId);
    if (!stored?.channel_id) throw error;
    log.info("playlist.feed_missing", { playlistId, channelId: stored.channel_id });
    return { playlistId, title: stored.title, channelId: stored.channel_id, channelTitle: stored.channel_title ?? "", videos: [] };
  }
}
