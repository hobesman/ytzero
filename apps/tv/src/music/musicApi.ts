import type { MusicPlayerTrack } from "../musicPlayerTypes";

/** A song as the server's music routes return it. */
export type MusicTrack = {
  videoId: string;
  title: string;
  artist: string;
  artistId: string | null;
  album: string | null;
  duration: number | null;
  thumbnail: string | null;
  isTopic: boolean;
  rating: 1 | -1 | null;
};

export type MusicSeed = { kind: "track"; videoId: string } | { kind: "liked" } | { kind: "mix" };
export type MusicEndReason = "completed" | "skipped" | "stopped";
export type MusicPlay = {
  videoId: string;
  startedAt: string;
  listenedSeconds: number;
  duration: number;
  endReason: MusicEndReason;
  stationSeed?: string | null;
};

export class MusicApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * Music mode's whole conversation with the server. It uses only `/music/*`,
 * so listening never touches video history, progress or subscriptions.
 */
type ArtworkSource = { uri: string; headers?: Record<string, string> };

export class MusicApi {
  private readonly artwork = new Map<string, ArtworkSource>();

  constructor(readonly instanceUrl: string, readonly accessToken?: string) {}

  private async request<T>(path: string, init: RequestInit = {}, timeout = 20000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`${this.instanceUrl}/api/music${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        },
      });
      const text = await response.text();
      let body: any = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
      if (!response.ok) throw new MusicApiError(typeof body.error === "string" ? body.error : `HTTP ${response.status}`, response.status);
      return body as T;
    } finally { clearTimeout(timer); }
  }

  async search(q: string): Promise<MusicTrack[]> {
    const result = await this.request<{ tracks?: MusicTrack[] }>(`/search?q=${encodeURIComponent(q.trim())}`, {}, 30000);
    return result.tracks ?? [];
  }

  station(seed: MusicSeed, served: string[], skipped: string[], count = 10): Promise<{ seed: string; tracks: MusicTrack[] }> {
    return this.request("/station", { method: "POST", body: JSON.stringify({ seed, served, skipped, count }) }, 30000);
  }

  /** Asks the server to fetch the start of a song so it begins without a wait. */
  async prepare(videoId: string): Promise<boolean> {
    const result = await this.request<{ ready?: boolean }>(`/tracks/${encodeURIComponent(videoId)}/prepare`, { method: "POST", body: "{}" }, 30000);
    return result.ready === true;
  }

  recordPlay(play: MusicPlay): Promise<{ ok: true }> {
    return this.request("/plays", { method: "POST", body: JSON.stringify(play) }, 8000);
  }

  rate(videoId: string, rating: 1 | 0 | -1): Promise<{ ok: true }> {
    return this.request(`/tracks/${encodeURIComponent(videoId)}/rating`, { method: "PUT", body: JSON.stringify({ rating }) }, 8000);
  }

  library(): Promise<{ liked: MusicTrack[]; recent: MusicTrack[] }> {
    return this.request("/library");
  }

  audioUrl(videoId: string): string {
    return `${this.instanceUrl}/api/music/tracks/${encodeURIComponent(videoId)}/audio`;
  }

  /** Artwork through the instance's image proxy, for the app's own screens. */
  artworkSource(url: string | null | undefined): ArtworkSource | null {
    if (!url) return null;
    // One object per address, so lists do not reload their images on each render.
    let source = this.artwork.get(url);
    if (!source) {
      source = {
        uri: `${this.instanceUrl}/api/img?u=${encodeURIComponent(url)}`,
        ...(this.accessToken ? { headers: { Authorization: `Bearer ${this.accessToken}` } } : {}),
      };
      if (this.artwork.size > 500) this.artwork.clear();
      this.artwork.set(url, source);
    }
    return source;
  }

  playerTrack(track: MusicTrack): MusicPlayerTrack {
    // The notification loads artwork itself, without the app's sign-in, so it gets YouTube's address.
    return { videoId: track.videoId, url: this.audioUrl(track.videoId), title: track.title, artist: track.artist, album: track.album, artwork: track.thumbnail };
  }
}
