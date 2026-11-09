import type { AuthStatus, BookmarkVideo, Bucket, Channel, ChannelAbout, PairingAuthorization, Profile, Tag, TvProfileSettings, UserPlaylist, Video, VideoComment } from "./types";
import type { ChannelSyncJob, ChannelSyncSnapshot, FollowedPlaylist } from "./types";
import type { PlaylistSort } from "./playlist";
import type { TvBrowseDestination } from "./navigation";
import type { PlaybackTicket } from "./types";
import type { PlaybackPosition } from "./playback";
import type { SponsorSegment } from "./sponsorBlock";
import { matchingChannels, searchChannel, searchVideo, type YoutubeSearchChannel, type YoutubeSearchVideo } from "./search";

type BrowseResult = { videos: Video[]; page: number; hasMore: boolean };
type ImageSource = { uri: string; headers?: Record<string, string> };

const TV_PAGE_SIZE = 24;
const EMPTY_IMAGE_SOURCE: ImageSource = { uri: "" };
const IMAGE_SOURCE_CACHE_LIMIT = 768;

type DownloadVideo = {
  video_id: string;
  status: "queued" | "downloading" | "done" | "error";
  title: string;
  thumbnail: string;
  duration: string | null;
  published_at: string | null;
  channel_title: string;
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function responseBody(response: Response): Promise<any> {
  return response.json().catch(() => ({}));
}

export class YtZeroApi {
  private readonly imageSources = new Map<string, ImageSource>();

  constructor(readonly instanceUrl: string, readonly accessToken?: string) {}

  private imageSource(uri: string): ImageSource {
    if (!uri) return EMPTY_IMAGE_SOURCE;
    const existing = this.imageSources.get(uri);
    if (existing) return existing;
    const source = {
      uri,
      ...(this.accessToken ? { headers: { Authorization: `Bearer ${this.accessToken}` } } : {}),
    };
    this.imageSources.set(uri, source);
    if (this.imageSources.size > IMAGE_SOURCE_CACHE_LIMIT) {
      const oldest = this.imageSources.keys().next().value;
      if (oldest) this.imageSources.delete(oldest);
    }
    return source;
  }

  private async request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
    const response = await fetch(`${this.instanceUrl}/api${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(authenticated && this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        ...init.headers,
      },
    });
    const body = await responseBody(response);
    if (!response.ok) throw new ApiError(typeof body.error === "string" ? body.error : `HTTP ${response.status}`, response.status);
    return body as T;
  }

  private async timedRequest<T>(path: string, init: RequestInit = {}, timeout = 8000): Promise<T> {
    // React Native's AbortSignal polyfill has no static timeout().
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await this.request<T>(path, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${this.instanceUrl}/api/health`, { signal: controller.signal });
      if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status);
      const body = await responseBody(response);
      if (body.status !== "ok") throw new ApiError("unhealthy instance", response.status);
    } finally { clearTimeout(timer); }
  }

  authStatus(): Promise<AuthStatus> {
    return this.timedRequest("/auth/status");
  }

  async beginPairing(): Promise<PairingAuthorization> {
    const result = await this.timedRequest<any>("/auth/device/code", {
      method: "POST",
      body: JSON.stringify({ device_name: "YT Zero TV" }),
    });
    return {
      deviceCode: result.device_code,
      userCode: result.user_code,
      verificationUri: result.verification_uri,
      verificationUriComplete: result.verification_uri_complete,
      expiresIn: result.expires_in,
      interval: result.interval,
    };
  }

  /** Phones: exchanges a username and password for a device sign-in token. The password is never stored. */
  async passwordSignIn(username: string, password: string): Promise<string> {
    const response = await fetch(`${this.instanceUrl}/api/auth/device/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const body = await responseBody(response);
    if (!response.ok || typeof body.access_token !== "string") throw new ApiError(String(body.error ?? "sign-in failed"), response.status);
    return body.access_token;
  }

  async pollPairing(deviceCode: string): Promise<{ kind: "pending" } | { kind: "authorized"; accessToken: string } | { kind: "expired" }> {
    const response = await fetch(`${this.instanceUrl}/api/auth/device/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
    });
    const body = await responseBody(response);
    if (response.status === 428 && body.error === "authorization_pending") return { kind: "pending" };
    if (response.status === 400 && body.error === "expired_token") return { kind: "expired" };
    if (!response.ok || typeof body.access_token !== "string") {
      throw new ApiError(typeof body.error === "string" ? body.error : `HTTP ${response.status}`, response.status);
    }
    return { kind: "authorized", accessToken: body.access_token };
  }

  settings(): Promise<{ settings: TvProfileSettings }> {
    return this.request("/settings");
  }

  profiles(): Promise<{ profiles: Profile[]; active_id: number; hide_other_profiles: boolean }> {
    return this.timedRequest("/profiles");
  }

  childLock(): Promise<{ child_lock: { enabled: boolean; locked: boolean } }> {
    return this.timedRequest("/child-lock");
  }

  async switchProfile(profileId: number, pin?: string, childLockPin?: string): Promise<{ active_id: number }> {
    const result = await this.request<{ active_id?: number; requires_relogin?: boolean }>("/profiles/switch", {
      method: "POST",
      body: JSON.stringify({ id: profileId, pin, child_lock_pin: childLockPin }),
    });
    if (typeof result.active_id !== "number") throw new ApiError("profile switch requires pairing again", 409);
    return { active_id: result.active_id };
  }

  avatarSource(url: string): ImageSource {
    if (!url) return EMPTY_IMAGE_SOURCE;
    return this.imageSource(new URL(url, `${this.instanceUrl}/`).toString());
  }

  thumbnailSource(url: string): ImageSource {
    if (!url) return EMPTY_IMAGE_SOURCE;
    const uri = /^https?:\/\//.test(url)
      ? `${this.instanceUrl}/api/img?u=${encodeURIComponent(url)}`
      : new URL(url, `${this.instanceUrl}/`).toString();
    return this.imageSource(uri);
  }

  shortThumbnailSource(videoId: string): ImageSource {
    const url = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/oardefault.jpg`;
    return this.imageSource(`${this.instanceUrl}/api/img?u=${encodeURIComponent(url)}&onMiss=error`);
  }

  backdropSource(url: string): ImageSource {
    try {
      const image = new URL(url);
      if (image.hostname === "i.ytimg.com" || image.hostname.endsWith(".ytimg.com")) {
        image.pathname = image.pathname.replace(/\/(?:default|mqdefault|hqdefault|sddefault)\.(jpg|webp)$/, "/maxresdefault.$1");
        const source = this.thumbnailSource(image.toString());
        return this.imageSource(`${source.uri}&onMiss=error`);
      }
    } catch {}
    return this.thumbnailSource(url);
  }

  feed(input: {
    page: number;
    q?: string;
    showAll?: boolean;
    sort?: "published" | "arrival";
    tags?: number[];
    channel?: string;
    status?: "inbox" | "all";
    shorts?: boolean;
    processing?: boolean;
  }): Promise<{ videos: Video[]; page: number; limit: number }> {
    const query = new URLSearchParams({ page: String(input.page), limit: String(TV_PAGE_SIZE) });
    if (input.q?.trim()) query.set("q", input.q.trim());
    if (input.showAll) query.set("show_all", "1");
    if (input.sort === "arrival") query.set("sort", "arrival");
    if (input.tags?.length) query.set("tags", input.tags.join(","));
    if (input.channel) query.set("channel", input.channel);
    if (input.status) query.set("status", input.status);
    if (input.shorts) query.set("shorts", "1");
    if (input.processing) query.set("processing", "1");
    return this.request(`/feed?${query}`);
  }

  tags(): Promise<{ tags: Tag[] }> {
    return this.request("/tags");
  }

  async searchLocal(q: string, page = 0) {
    const [feed, channels] = await Promise.all([this.feed({ q, page, status: "all" }), page === 0 ? this.channels() : Promise.resolve({ channels: [] })]);
    return { videos: feed.videos, channels: matchingChannels(channels.channels, q), hasMore: feed.videos.length === feed.limit };
  }

  async searchYoutube(q: string) {
    const policy = await this.timedRequest<{ local_only: boolean }>("/child/status");
    if (policy.local_only) return { videos: [], channels: [] };
    const result = await this.timedRequest<{ results?: YoutubeSearchVideo[]; channels?: YoutubeSearchChannel[] }>(`/search/youtube?q=${encodeURIComponent(q.trim())}`, {}, 45000);
    return { videos: (result.results ?? []).map(searchVideo), channels: (result.channels ?? []).map(searchChannel) };
  }

  channels(): Promise<{ channels: Channel[]; instance_has_data: boolean }> {
    return this.request("/channels");
  }

  topChannels(): Promise<{ channels: Channel[] }> {
    return this.request("/channels/top");
  }

  async channel(id: string): Promise<{ channel: Channel }> {
    try { return await this.request(`/channels/${encodeURIComponent(id)}`); }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      await this.channelAbout(id);
      return this.request(`/channels/${encodeURIComponent(id)}`);
    }
  }

  channelAbout(id: string): Promise<ChannelAbout> {
    return this.request(`/channels/${encodeURIComponent(id)}/about`);
  }

  channelLive(id: string): Promise<{ videos: Video[] }> {
    return this.request(`/channels/${encodeURIComponent(id)}/live`);
  }

  channelVideos(id: string, page = 0): Promise<{ videos: Video[]; page: number; limit: number }> {
    return this.feed({ channel: id, page, shorts: true, status: "all" });
  }

  channelSyncStatus(): Promise<ChannelSyncSnapshot> {
    return this.timedRequest("/channels/sync");
  }
  syncChannel(id: string): Promise<{ job: ChannelSyncJob }> {
    return this.timedRequest(`/channels/${encodeURIComponent(id)}/sync`, { method: "POST" });
  }
  followedPlaylists(): Promise<{ playlists: FollowedPlaylist[] }> {
    return this.timedRequest("/followed-playlists");
  }
  channelPlaylist(id: string): Promise<{ playlist: FollowedPlaylist }> {
    return this.timedRequest(`/channel-playlists/${encodeURIComponent(id)}`);
  }
  channelPlaylistVideos(id: string, sort?: PlaylistSort): Promise<{ videos: Video[]; processing: Video[]; order: string[]; sort?: PlaylistSort }> {
    return this.timedRequest(`/channel-playlists/${encodeURIComponent(id)}/videos${sort ? `?sort=${encodeURIComponent(sort)}` : ""}`);
  }

  updatePlaylistSort(id: string, sort: PlaylistSort): Promise<{ sort: PlaylistSort }> {
    return this.timedRequest(`/channel-playlists/${encodeURIComponent(id)}/sort`, { method: "PUT", body: JSON.stringify({ sort }) });
  }

  followChannel(id: string, followed: boolean): Promise<{ ok: true }> {
    return this.request(`/channels/${encodeURIComponent(id)}/follow`, {
      method: "PUT",
      body: JSON.stringify({ followed }),
    });
  }

  inProgress(): Promise<{ videos: Video[] }> {
    return this.request("/in-progress");
  }

  watchlist(): Promise<{ videos: Video[] }> {
    return this.request("/watchlist");
  }

  bookmarks(): Promise<{ bookmarks: BookmarkVideo[] }> {
    return this.request("/bookmarks");
  }

  async video(id: string): Promise<{ video: Video; related: Video[] }> {
    try { return await this.request(`/videos/${encodeURIComponent(id)}`); }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      // The same metadata import as the web player; it does not download media.
      await this.timedRequest(`/videos/${encodeURIComponent(id)}/info`, {}, 45000);
      return this.request(`/videos/${encodeURIComponent(id)}`);
    }
  }

  videoComments(id: string): Promise<{ comments: VideoComment[]; fetchedAt: string; cached: boolean }> {
    return this.request(`/videos/${encodeURIComponent(id)}/comments?sort=top`);
  }

  /**
   * `prefer: "progressive"` asks for the single stream after a high-quality stream failed.
   * `quality` ("auto" or a height) shapes a streamed video; servers that predate it ignore it.
   */
  async playbackTicket(id: string, signal?: AbortSignal, prefer?: "progressive", quality?: string): Promise<PlaybackTicket> {
    const body = { ...(prefer ? { prefer } : {}), ...(quality && !prefer ? { quality } : {}) };
    for (;;) {
      const result = await this.request<PlaybackTicket | { preparing: true }>(`/videos/${encodeURIComponent(id)}/playback-ticket`, { method: "POST", body: JSON.stringify(body), signal });
      if (!("preparing" in result)) return result;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new Error("playback cancelled")); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 2000);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
  }

  renewPlaybackTicket(id: string, ticket: string): Promise<{ expires_in: number }> {
    return this.timedRequest(`/videos/${encodeURIComponent(id)}/playback-ticket`, { method: "PUT", body: JSON.stringify({ ticket }) });
  }

  releasePlaybackTicket(id: string, ticket: string): Promise<{ ok: true }> {
    return this.timedRequest(`/videos/${encodeURIComponent(id)}/playback-ticket`, { method: "DELETE", body: JSON.stringify({ ticket }) });
  }

  playbackSource(ticket: PlaybackTicket): { uri: string; contentType: "hls" | "progressive" } {
    const uri = new URL(ticket.url, `${this.instanceUrl}/`);
    // Keep the native format hint paired with its transport. In particular,
    // undownloaded videos use HLS, including its separate audio rendition.
    const mediaPath = ticket.content_type === "hls"
      ? /^\/api\/videos\/[^/]+\/(?:live-hls|direct-hls|hls)\/index\.m3u8$/
      : ticket.content_type === "progressive" ? /^\/api\/videos\/[^/]+\/(?:stream|direct-stream)$/ : null;
    if (uri.origin !== new URL(this.instanceUrl).origin || uri.username || uri.password || !mediaPath?.test(uri.pathname) || uri.searchParams.get("media_ticket") !== ticket.ticket) {
      throw new ApiError("invalid playback source", 502);
    }
    return { uri: uri.toString(), contentType: ticket.content_type };
  }

  savePlaybackProgress(id: string, value: PlaybackPosition): Promise<{ ok: true }> {
    return this.timedRequest(`/videos/${encodeURIComponent(id)}/progress`, { method: "PUT", body: JSON.stringify(value) }, 6000);
  }

  playbackAdjacent(id: string, direction: "oldest" | "newest", context: import("./playbackQueue").PlaybackQueueContext, relative: "next" | "previous" = "next"): Promise<{ video_id: string | null }> {
    return this.timedRequest("/playback/adjacent", { method: "POST", body: JSON.stringify({ video_id: id, direction, context, relative }) });
  }

  playbackRestriction(): Promise<{ locked: boolean; is_child: boolean }> {
    return this.timedRequest("/child/status", {}, 6000);
  }

  async browse(
    destination: TvBrowseDestination,
    input: { page: number; showAll: boolean; sort: "published" | "arrival" },
  ): Promise<BrowseResult> {
    const { page } = input;
    if (destination === "/") {
      const result = await this.feed(input);
      return { videos: result.videos, page: result.page, hasMore: result.videos.length === result.limit };
    }
    if (destination === "/recommendations") {
      const result = await this.request<{ videos: Video[]; page: number; has_more: boolean }>(`/recommendations?page=${page}&limit=${TV_PAGE_SIZE}`);
      return { videos: result.videos, page: result.page, hasMore: result.has_more };
    }
    if (destination === "/shorts") {
      const result = await this.request<{ videos: Video[]; page: number; limit: number }>(`/feed?page=${page}&limit=${TV_PAGE_SIZE}&shorts=1&only_shorts=1`);
      return { videos: result.videos, page: result.page, hasMore: result.videos.length === result.limit };
    }
    if (destination === "/liked") {
      const result = await this.request<{ videos: Video[]; page: number; limit: number }>(`/feed?page=${page}&limit=${TV_PAGE_SIZE}&liked=1&status=all&all_sources=1&shorts=1`);
      return { videos: result.videos, page: result.page, hasMore: result.videos.length === result.limit };
    }
    if (destination === "/archive") {
      const result = await this.request<{ videos: Video[]; page: number }>(`/archive?page=${page}`);
      return { videos: result.videos, page: result.page, hasMore: result.videos.length === 60 };
    }
    if (destination === "/history") {
      const result = await this.request<{ videos: Video[]; page: number; has_more: boolean }>(`/history?page=${page}`);
      return { videos: result.videos, page: result.page, hasMore: result.has_more };
    }

    // These endpoints return complete collections rather than pages.
    if (page > 0) return { videos: [], page, hasMore: false };
    if (destination === "/live" || destination === "/watchlist") {
      const result = await this.request<{ videos: Video[] }>(destination);
      return { videos: result.videos, page, hasMore: false };
    }
    if (destination === "/bookmarks") {
      const result = await this.bookmarks();
      return { videos: result.bookmarks, page, hasMore: false };
    }
    if (destination === "/followed-playlists") return { videos: [], page, hasMore: false };

    const result = await this.request<{ downloads: DownloadVideo[] }>("/downloads");
    const videos = result.downloads
      .filter((download) => download.status === "done")
      .map<Video>((download) => ({
        video_id: download.video_id,
        title: download.title,
        description: "",
        thumbnail: download.thumbnail,
        channel_title: download.channel_title,
        published_at: download.published_at,
        duration: download.duration,
        live_status: "none",
        watched: null,
        status: "inbox",
      }));
    return { videos, page, hasMore: false };
  }

  markWatched(videoId: string): Promise<{ ok: true }> {
    return this.timedRequest(`/videos/${encodeURIComponent(videoId)}/complete`, { method: "POST", body: "{}" }, 6000);
  }

  recordPlayback(videoId: string, context: import("./playbackQueue").PlaybackQueueContext | null): Promise<{ ok: true }> {
    return this.timedRequest(`/videos/${encodeURIComponent(videoId)}/watch`, { method: "POST", body: JSON.stringify(context ? { playback_context: context } : {}) }, 6000);
  }

  markUnwatched(videoId: string): Promise<{ ok: true }> {
    return this.request(`/videos/${encodeURIComponent(videoId)}/complete`, { method: "DELETE" });
  }

  queue(videoId: string, bucket: Bucket): Promise<{ ok: true }> {
    return this.request(`/videos/${encodeURIComponent(videoId)}/queue`, {
      method: "POST",
      body: JSON.stringify({ bucket }),
    });
  }

  dequeue(videoId: string): Promise<{ ok: true }> {
    return this.request(`/videos/${encodeURIComponent(videoId)}/dequeue`, { method: "POST", body: "{}" });
  }

  /** Profile settings on the server; the same ones the web settings page edits. */
  updateSettings(patch: Partial<Record<keyof TvProfileSettings, string>>): Promise<{ ok: true }> {
    return this.timedRequest("/settings", { method: "PUT", body: JSON.stringify(patch) });
  }

  setChannelSpeed(channelId: string, speed: string | null): Promise<{ ok: true }> {
    return this.timedRequest(`/channels/${encodeURIComponent(channelId)}/speed`, { method: "PUT", body: JSON.stringify({ speed }) });
  }

  /** Counts the skipped time in Pulse, like the web player. */
  recordSponsorBlockSkip(videoId: string, segment: SponsorSegment, skippedSeconds: number): Promise<{ ok: true; recorded: boolean }> {
    return this.timedRequest(`/videos/${encodeURIComponent(videoId)}/sponsorblock-skip`, { method: "POST", body: JSON.stringify({
      event_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, segment_uuid: segment.UUID, category: segment.category,
      skipped_seconds: skippedSeconds, segment_start: segment.segment[0], segment_end: segment.segment[1],
    }) });
  }

  likeVideo(videoId: string, liked: boolean): Promise<{ ok: true }> {
    return this.request(`/videos/${encodeURIComponent(videoId)}/like`, {
      method: "PUT",
      body: JSON.stringify({ liked }),
    });
  }

  reject(videoId: string): Promise<{ ok: true }> {
    return this.request(`/videos/${encodeURIComponent(videoId)}/archive`, { method: "POST", body: "{}" });
  }

  restore(videoId: string): Promise<{ ok: true }> {
    return this.request(`/videos/${encodeURIComponent(videoId)}/restore`, { method: "POST", body: "{}" });
  }

  userPlaylists(videoId: string): Promise<{ playlists: UserPlaylist[] }> {
    return this.request(`/playlists?video_id=${encodeURIComponent(videoId)}`);
  }

  addVideoToUserPlaylist(playlistId: number, videoId: string): Promise<{ ok: true }> {
    return this.request(`/playlists/${playlistId}/videos`, {
      method: "POST",
      body: JSON.stringify({ video_id: videoId }),
    });
  }

  removeVideoFromUserPlaylist(playlistId: number, videoId: string): Promise<{ ok: true }> {
    return this.request(`/playlists/${playlistId}/videos/${encodeURIComponent(videoId)}`, { method: "DELETE" });
  }

  downloadVideo(videoId: string): Promise<{ ok: true }> {
    return this.request(`/videos/${encodeURIComponent(videoId)}/download`, { method: "POST", body: "{}" });
  }

  cancelVideoDownload(videoId: string): Promise<{ ok: true }> {
    return this.request(`/videos/${encodeURIComponent(videoId)}/download`, { method: "DELETE" });
  }

  removeFromHistory(historyId: number): Promise<{ ok: true }> {
    return this.request(`/history/${historyId}`, { method: "DELETE" });
  }

  logout(): Promise<{ ok: true }> {
    return this.request("/auth/logout", { method: "POST", body: "{}" });
  }
}
