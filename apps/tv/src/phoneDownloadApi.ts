import { ApiError, YtZeroApi, type ImageSource } from "./api";
import type { PlaybackPosition } from "./playback";
import type { PhoneDownloadStore } from "./phoneDownloads";
import type { PlaybackQueueContext } from "./playbackQueue";
import type { PlaybackTicket, Video } from "./types";

/** Stands in for a media ticket when the video plays from a file on the phone. */
const LOCAL_TICKET = "local-file";

/**
 * The API client, aware of videos saved on the phone. Those play from their
 * file, so the same player (background playback, mini player, speed) works
 * with no connection. Their positions are kept on the phone too, and the ones
 * the server could not be told about are sent when it can be reached again.
 */
export class PhoneDownloadApi extends YtZeroApi {
  constructor(instanceUrl: string, accessToken: string | undefined, private readonly downloads: PhoneDownloadStore) {
    super(instanceUrl, accessToken);
  }

  /** Offline, a downloaded video's page shows the details saved with it. */
  override async video(id: string): Promise<{ video: Video; related: Video[] }> {
    try { return await super.video(id); }
    catch (error) {
      const saved = this.downloads.find(id);
      if (saved?.state === "done" && !(error instanceof ApiError)) return { video: saved.video, related: [] };
      throw error;
    }
  }

  override async playbackTicket(id: string, signal?: AbortSignal, prefer?: "progressive", quality?: string): Promise<PlaybackTicket> {
    const uri = this.downloads.localUri(id);
    if (uri) return { ticket: LOCAL_TICKET, url: uri, content_type: "progressive", expires_in: 24 * 60 * 60 };
    return super.playbackTicket(id, signal, prefer, quality);
  }

  override playbackSource(ticket: PlaybackTicket): { uri: string; contentType: "hls" | "progressive" } {
    if (ticket.ticket === LOCAL_TICKET && ticket.url.startsWith("file://")) return { uri: ticket.url, contentType: "progressive" };
    return super.playbackSource(ticket);
  }

  override async renewPlaybackTicket(id: string, ticket: string): Promise<{ expires_in: number }> {
    return ticket === LOCAL_TICKET ? { expires_in: 24 * 60 * 60 } : super.renewPlaybackTicket(id, ticket);
  }

  override async releasePlaybackTicket(id: string, ticket: string): Promise<{ ok: true }> {
    return ticket === LOCAL_TICKET ? { ok: true } : super.releasePlaybackTicket(id, ticket);
  }

  override async savePlaybackProgress(id: string, value: PlaybackPosition): Promise<{ ok: true }> {
    if (!this.downloads.find(id)) return super.savePlaybackProgress(id, value);
    try {
      const result = await super.savePlaybackProgress(id, value);
      this.downloads.recordPlayback(id, value, false, false);
      return result;
    } catch {
      this.downloads.recordPlayback(id, value, false, true);
      return { ok: true };
    }
  }

  override async markWatched(id: string): Promise<{ ok: true }> {
    if (!this.downloads.find(id)) return super.markWatched(id);
    try {
      const result = await super.markWatched(id);
      this.downloads.recordPlayback(id, { position: 0, duration: 0 }, true, false);
      return result;
    } catch {
      this.downloads.recordPlayback(id, { position: 0, duration: 0 }, true, true);
      return { ok: true };
    }
  }

  /** A downloaded video watched offline is not added to History later: it would carry the wrong time. */
  override async recordPlayback(id: string, context: PlaybackQueueContext | null): Promise<{ ok: true }> {
    try { return await super.recordPlayback(id, context); }
    catch (error) { if (this.downloads.localUri(id)) return { ok: true }; throw error; }
  }

  private readonly localSources = new Map<string, ImageSource>();

  override thumbnailSource(url: string): ImageSource {
    const local = this.downloads.localThumbnail(url);
    if (!local) return super.thumbnailSource(url);
    // The same object for the same file, so lists don't reload the image.
    let source = this.localSources.get(local);
    if (!source) { source = { uri: local }; this.localSources.set(local, source); }
    return source;
  }
}
