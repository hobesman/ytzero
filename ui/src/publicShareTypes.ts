import type { AvailableSubtitle, VideoChapter, VideoSubtitle } from "./apiTypes";

export type PublicShareResourceType = "video" | "user_playlist" | "followed_playlist";

export interface ManagedPublicShare {
  id: string;
  token: string;
  url: string;
  owner_user_id: number;
  owner_name?: string;
  resource_type: PublicShareResourceType;
  resource_id: string;
  resource_title: string;
  video_count: number;
  allow_local_media: boolean;
  /** Non-local videos stream through this server (its IP, YouTube session and bandwidth). */
  allow_server_stream: boolean;
  /** null means no play limit. */
  max_plays: number | null;
  play_count: number;
  plays_remaining: number | null;
  /** ISO timestamp; null means the link does not expire. */
  expires_at: string | null;
  active: boolean;
  suspension_reason: "policy_disabled" | "permission_suspended" | "resource_unavailable" | "expired" | "plays_exhausted" | null;
  created_at: string;
  updated_at: string;
}

/** A management PATCH. Hours count from now; null removes that limit. */
export interface PublicShareUpdate {
  allow_local_media?: boolean;
  allow_server_stream?: boolean;
  max_plays?: number | null;
  expires_in_hours?: number | null;
  reset_plays?: boolean;
}

export interface PublicShareManagementResponse {
  policy: { enabled: boolean; can_manage: boolean };
  shares: ManagedPublicShare[];
}

export interface PublicShareVideo {
  video_id: string;
  channel_id: string;
  title: string;
  description: string;
  thumbnail: string;
  published_at: string | null;
  published_at_approximate: number;
  live_status: string;
  duration: string | null;
  views: number | null;
  likes: number | null;
  channel_title: string;
}

export interface PublicShareData {
  brand: { name: string; icon: string; color: string };
  resource: { type: PublicShareResourceType; id: string; title: string; video_count: number };
  page: number;
  page_size: number;
  has_more: boolean;
  items: PublicShareVideo[];
  video: PublicShareVideo | null;
  creators: Array<{ channel_id: string; title: string; avatar: string; handle: string; subscriber_count: string; is_owner: number }>;
  chapters: VideoChapter[];
  subtitles: { subtitles: VideoSubtitle[]; available: AvailableSubtitle[] };
  playback: { kind: "local"; source: "download" | "tubearchivist"; url: string } | { kind: "stream"; url: string; video_id: string }
    | { kind: "youtube"; video_id: string }
    | null;
  allow_local_media: boolean;
}
