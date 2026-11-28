import { randomBytes } from "node:crypto";

/** "bridge": the fast-start stream that plays while the chosen quality gets ready (bridgeVideoStreaming.ts). */
export type NativeMediaKind = "file" | "hls" | "direct" | "direct-hls" | "live-hls" | "bridge";
export type MediaTicket = {
  userId: number;
  videoId: string;
  sessionToken: string;
  kind: NativeMediaKind;
  expiresAt: number;
};

export const MEDIA_TICKET_TTL_MS = 15 * 60_000;
/**
 * How long a lapsed ticket stays renewable. It serves no media once lapsed,
 * but its owner may renew it: a phone whose timers stopped while paused in the
 * background then keeps the stream it loaded, and the buffer with it.
 */
export const MEDIA_TICKET_RENEWAL_GRACE_MS = 6 * 60 * 60_000;

/** Process-local capabilities, never database/settings/backup data. */
export class MediaTicketStore {
  private readonly tickets = new Map<string, MediaTicket>();
  constructor(private readonly now = Date.now, private readonly capacity = 4096) {}

  issue(input: Omit<MediaTicket, "expiresAt">): string {
    for (const [key, ticket] of this.tickets) {
      if (ticket.expiresAt + MEDIA_TICKET_RENEWAL_GRACE_MS <= this.now()) this.tickets.delete(key);
    }
    while (this.tickets.size >= this.capacity) this.tickets.delete(this.tickets.keys().next().value!);
    const token = randomBytes(32).toString("base64url");
    this.tickets.set(token, { ...input, expiresAt: this.now() + MEDIA_TICKET_TTL_MS });
    return token;
  }

  /** A ticket that may still serve media. */
  read(token: string): MediaTicket | null {
    const ticket = this.held(token);
    return ticket && ticket.expiresAt > this.now() ? ticket : null;
  }

  /** A ticket still held, lapsed or not, if it belongs to this session's viewer and video. */
  owned(token: string, userId: number, videoId: string, sessionToken: string): MediaTicket | null {
    const ticket = this.held(token);
    return ticket && ticket.userId === userId && ticket.videoId === videoId && ticket.sessionToken === sessionToken ? ticket : null;
  }

  renew(token: string, userId: number, videoId: string, sessionToken: string): boolean {
    const ticket = this.owned(token, userId, videoId, sessionToken);
    if (!ticket) return false;
    ticket.expiresAt = this.now() + MEDIA_TICKET_TTL_MS;
    return true;
  }

  private held(token: string): MediaTicket | null {
    const ticket = this.tickets.get(token);
    if (!ticket) return null;
    if (ticket.expiresAt + MEDIA_TICKET_RENEWAL_GRACE_MS <= this.now()) {
      this.tickets.delete(token);
      return null;
    }
    return ticket;
  }

  revoke(token: string): void { this.tickets.delete(token); }
}

export function mediaTicketPath(ticket: Pick<MediaTicket, "videoId" | "kind">): string {
  const base = `/api/videos/${encodeURIComponent(ticket.videoId)}`;
  if (ticket.kind === "hls" || ticket.kind === "direct-hls" || ticket.kind === "live-hls") return `${base}/${ticket.kind}/index.m3u8`;
  if (ticket.kind === "bridge") return `${base}/bridge-stream`;
  return ticket.kind === "file" ? `${base}/stream?compat=1` : `${base}/direct-stream`;
}

export function ticketAllowsPath(ticket: Pick<MediaTicket, "videoId" | "kind">, pathname: string, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const base = `/api/videos/${encodeURIComponent(ticket.videoId)}`;
  if (ticket.kind === "file") return pathname === `${base}/stream`;
  if (ticket.kind === "direct") return pathname === `${base}/direct-stream`;
  if (ticket.kind === "bridge") return pathname === `${base}/bridge-stream`;
  const prefix = `${base}/${ticket.kind}/`;
  if (!pathname.startsWith(prefix)) return false;
  const file = pathname.slice(prefix.length);
  if (ticket.kind === "live-hls") return /^(?:index|video|audio)\.m3u8$/.test(file) || /^r[av][a-f0-9]{16}_\d+$/.test(file);
  return /^(?:index|video|audio)\.m3u8$|^(?:video|audio)\.mp4$/.test(file)
    || (ticket.kind === "hls" && /^seg\d+\.ts$/.test(file));
}

/** Rewrite both variant/segment lines and EXT-X-MAP/KEY/MEDIA URI attributes. */
export function authorizeHlsPlaylist(playlist: string, requestUrl: string, ticket: MediaTicket, token: string): string {
  const base = new URL(requestUrl);
  const authorize = (uri: string) => {
    const url = new URL(uri, base);
    if (url.origin !== base.origin || url.username || url.password || !ticketAllowsPath(ticket, url.pathname, "GET")) {
      throw new Error("unsupported media resource");
    }
    url.searchParams.set("media_ticket", token);
    return `${url.pathname}${url.search}`;
  };
  return playlist.split(/\r?\n/).map((line) => {
    const value = line.trim();
    if (!value) return line;
    if (!value.startsWith("#")) return authorize(value);
    return line.replace(/\bURI="([^"]+)"/g, (_, uri: string) => `URI="${authorize(uri)}"`);
  }).join("\n");
}
