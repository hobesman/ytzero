import { fetchChannelFeed, fetchChannelVideos } from "./youtube";
import { log } from "./logger";
import { isYouTubeRefusalError } from "./youtubeRateLimit";

export interface RecentUpload {
  videoId: string;
  title: string;
  description: string;
  thumbnail: string;
  publishedAt: string | null;
  publishedAtApproximate: boolean;
  views: number | null;
  likes: number | null;
  duration: string | null;
  membersOnly: boolean;
}

export interface RecentUploads {
  source: "rss" | "uploads-page";
  channelTitle: string;
  videos: RecentUpload[];
}

/** A channel's newest uploads for the quick refresh. RSS is the normal source,
 * but YouTube's feed endpoint has returned 404 for every channel for long
 * stretches. The first page of the channel's /videos tab then stands in: it
 * has no descriptions, exact dates or livestreams, which full syncs and the
 * metadata maintenance fill in later. */
export async function fetchRecentUploads(channelId: string, userId?: number): Promise<RecentUploads> {
  let rssError: unknown;
  try {
    const feed = await fetchChannelFeed(channelId, userId);
    return {
      source: "rss",
      channelTitle: feed.channelTitle,
      videos: feed.videos.map((video) => ({
        videoId: video.videoId, title: video.title, description: video.description,
        thumbnail: video.thumbnail, publishedAt: video.publishedAt, publishedAtApproximate: false,
        views: video.views, likes: video.likes, duration: null, membersOnly: false,
      })),
    };
  } catch (error) {
    // A rate limit or address refusal asks for less traffic, not another
    // endpoint: scraping now would only deepen the refusal.
    if (isYouTubeRefusalError(error)) throw error;
    rssError = error;
  }

  const rssMessage = rssError instanceof Error ? rssError.message : String(rssError);
  log.warn("channel.refresh.rss_fallback", { channelId, error: rssMessage });
  let scraped: Awaited<ReturnType<typeof fetchChannelVideos>>;
  try {
    scraped = await fetchChannelVideos(channelId, userId);
  } catch (error) {
    if (isYouTubeRefusalError(error)) throw error;
    throw new Error(`${rssMessage}; uploads page fallback failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    source: "uploads-page",
    channelTitle: "",
    videos: scraped.map((video) => ({
      videoId: video.videoId, title: video.title, description: "",
      thumbnail: video.thumbnail, publishedAt: video.publishedAt,
      publishedAtApproximate: video.publishedAtApproximate,
      views: video.viewCount, likes: null, duration: video.duration || null,
      membersOnly: video.membersOnly,
    })),
  };
}
