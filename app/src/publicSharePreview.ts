import type { PublicShareRow, PublicShareVideo, ResolvedPublicShare } from "./publicSharing";

// Link-preview crawlers (WhatsApp, Telegram, Discord, Slack, iMessage, Signal)
// read Open Graph tags from the HTML and run no JavaScript, so the share page
// shell carries them. Fetching the shell or the thumbnail never uses a play.

export interface PublicSharePreview {
  siteName: string;
  title: string;
  url: string;
  image: string | null;
  type: "video.other" | "website";
  description: string | null;
}

export interface PublicSharePreviewInput {
  resolved: ResolvedPublicShare;
  /** The video the page opens: the one in the path, the shared video, or a playlist's first. */
  video: PublicShareVideo | null;
  /** Set when the path names a video (`/share/:token/video/:videoId`). */
  pathVideoId?: string;
  baseUrl: string;
  siteName: string;
  /** False for a link past its expiry or play limit. */
  active: boolean;
}

/** Database lookups, passed in so this module stays free of the database. */
export interface PublicSharePreviewLookups {
  videoIds: (share: PublicShareRow, page: number) => Promise<string[]>;
  video: (videoId: string) => Promise<PublicShareVideo | null>;
}

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function shareUrl(baseUrl: string, token: string, pathVideoId?: string): string {
  const path = `/share/${encodeURIComponent(token)}`;
  return baseUrl + (pathVideoId ? `${path}/video/${encodeURIComponent(pathVideoId)}` : path);
}

function previewImage(baseUrl: string, token: string, video: PublicShareVideo): string | null {
  // The share's own thumbnail route is public while the link is active.
  if (video.thumbnail) return `${baseUrl}/share/${encodeURIComponent(token)}/thumbnail/${encodeURIComponent(video.video_id)}`;
  return YOUTUBE_VIDEO_ID.test(video.video_id) ? `https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg` : null;
}

/** An expired or used-up link previews as the bare site, revealing nothing it shared. */
export function buildPublicSharePreview(input: PublicSharePreviewInput): PublicSharePreview {
  const { resolved: { share, resource }, video, pathVideoId, baseUrl, siteName } = input;
  const url = shareUrl(baseUrl, share.token, pathVideoId);
  if (!input.active) {
    return { siteName, title: siteName, url, image: null, type: "website", description: null };
  }
  const showsVideo = share.resource_type === "video" || Boolean(pathVideoId);
  const title = (showsVideo ? video?.title : resource.title) || resource.title || siteName;
  return {
    siteName,
    title,
    url,
    image: video ? previewImage(baseUrl, share.token, video) : null,
    type: showsVideo ? "video.other" : "website",
    description: showsVideo ? video?.channel_title || null : null,
  };
}

export async function loadPublicSharePreview(input: Omit<PublicSharePreviewInput, "video">, lookups: PublicSharePreviewLookups): Promise<PublicSharePreview> {
  const { share } = input.resolved;
  let video: PublicShareVideo | null = null;
  if (input.active) {
    const videoId = input.pathVideoId ?? (share.resource_type === "video" ? share.resource_id : (await lookups.videoIds(share, 0))[0]);
    video = videoId ? await lookups.video(videoId) : null;
  }
  return buildPublicSharePreview({ ...input, video });
}

export function publicSharePreviewTags(preview: PublicSharePreview): string {
  const meta = (attribute: "property" | "name", key: string, value: string) =>
    `<meta ${attribute}="${key}" content="${escapeHtml(value)}" />`;
  const tags = [
    `<title>${escapeHtml(preview.title)}</title>`,
    meta("property", "og:site_name", preview.siteName),
    meta("property", "og:title", preview.title),
    meta("property", "og:type", preview.type),
    meta("property", "og:url", preview.url),
  ];
  if (preview.description) tags.push(meta("property", "og:description", preview.description));
  if (preview.image) tags.push(meta("property", "og:image", preview.image));
  tags.push(meta("name", "twitter:card", preview.image ? "summary_large_image" : "summary"));
  tags.push(meta("name", "twitter:title", preview.title));
  if (preview.image) tags.push(meta("name", "twitter:image", preview.image));
  return tags.join("\n    ");
}

/** Replaces the shell's `<title>` with the preview tags, or adds them to the head. */
export function injectPublicSharePreview(html: string, preview: PublicSharePreview): string {
  const tags = publicSharePreviewTags(preview);
  if (/<title>[^<]*<\/title>/i.test(html)) return html.replace(/<title>[^<]*<\/title>/i, () => tags);
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, () => `${tags}\n  </head>`);
  return tags + html;
}
