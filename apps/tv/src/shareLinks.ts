/** Links the phone app shares: the public YouTube pages, and the text that goes with them. */

const videoIdPattern = /^[\w-]{6,20}$/;

/** A video's youtube.com page, or null for an id that isn't a YouTube video id. */
export function youtubeVideoUrl(videoId: string): string | null {
  return videoIdPattern.test(videoId) ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

/** A song's music.youtube.com page, which opens in YouTube Music. */
export function youtubeMusicUrl(videoId: string): string | null {
  return videoIdPattern.test(videoId) ? `https://music.youtube.com/watch?v=${videoId}` : null;
}

/**
 * The text handed to Android's share sheet. Android has no separate URL
 * field, so the link goes on its own line after the title.
 */
export function shareMessage(title: string, url: string, byline?: string | null): string {
  const heading = [title.trim(), byline?.trim()].filter(Boolean).join(" – ");
  return heading ? `${heading}\n${url}` : url;
}
