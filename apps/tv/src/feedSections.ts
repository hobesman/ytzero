import type { Bucket, Channel, Tag, Video } from "./types";

const bucketOrder: Bucket[] = ["today", "tonight", "tomorrow", "tomorrow_evening", "weekend"];

function parseAppTimestamp(value: string): Date {
  const normalized = value.trim().replace(" ", "T");
  return new Date(/[zZ]|[+-]\d\d(?::?\d\d)?$/.test(normalized) ? normalized : `${normalized}Z`);
}

export function visibleFeedTags(tags: Tag[]): Tag[] {
  return tags.filter((tag) => !tag.hidden_from_filters);
}

/** The web feed uses ANY-tag matching for the watched-channel shelf. */
export function channelsForTags(topChannels: Channel[], channels: Channel[], selectedTags: number[]): Channel[] {
  if (selectedTags.length === 0) return topChannels;
  const selected = new Set(selectedTags);
  return channels.filter((channel) => channel.tags.some((tag) => selected.has(tag.id)));
}

export function dueScheduledVideos(videos: Video[], now = new Date()): Video[] {
  return scheduledVideosInOrder(videos.filter((video) => !video.show_from || parseAppTimestamp(video.show_from) <= now));
}

/** Match the server's watchlist schedule, including deterministic ties. */
export function scheduledVideosInOrder(videos: Video[]): Video[] {
  return videos.filter((video) => video.bucket && bucketOrder.includes(video.bucket))
    .sort((left, right) => {
      const bucketDifference = bucketOrder.indexOf(left.bucket!) - bucketOrder.indexOf(right.bucket!);
      if (bucketDifference !== 0) return bucketDifference;
      const leftTime = left.show_from ? parseAppTimestamp(left.show_from).getTime() : 0;
      const rightTime = right.show_from ? parseAppTimestamp(right.show_from).getTime() : 0;
      return leftTime - rightTime
        || String(right.queued_at ?? "").localeCompare(String(left.queued_at ?? ""))
        || right.video_id.localeCompare(left.video_id);
    });
}

/** The server's Continue watching rule (libraryRoutes `/in-progress`): stopped part-way through a non-trivial video. */
export function partlyWatched(video: Pick<Video, "watch_position" | "watch_duration">): boolean {
  const position = video.watch_position ?? null;
  const duration = video.watch_duration ?? null;
  return position != null && duration != null && duration > 30 && position >= 3 && position / duration < 0.92;
}

/** Whether a video still belongs on Continue watching after the player or an action changed it. */
export function staysInProgress(video: Pick<Video, "watch_position" | "watch_duration" | "status">): boolean {
  return partlyWatched(video) && video.status === "inbox";
}

export function withoutInProgress(videos: Video[], inProgress: Video[]): Video[] {
  const inProgressIds = new Set(inProgress.map((video) => video.video_id));
  return videos.filter((video) => !inProgressIds.has(video.video_id));
}
