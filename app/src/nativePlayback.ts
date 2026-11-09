import type { Context, Next } from "hono";
import { existsSync, statSync } from "node:fs";
import { validateSession } from "./auth";
import { childStatus, type ChildStatus } from "./childTime";
import { database } from "./database";
import { directVideoStreaming } from "./directVideoStreaming";
import { log } from "./logger";
import { nativeKindForDirectPlaylist } from "./nativePlaybackKind";
import { ensureMobilePlayback, getDownload, ytdlpStatus } from "./downloader";
import { authorizeHlsPlaylist, MediaTicketStore, ticketAllowsPath, type NativeMediaKind } from "./mediaTickets";
import { tubeArchivistConfigured } from "./tubeArchivist";

export const mediaTickets = new MediaTicketStore();

const preparations = new Map<string, { stamp: string; expires: number; complete: Promise<boolean> }>();
async function mediaPrepared(path: string): Promise<boolean> {
  const stat = statSync(path);
  const stamp = `${stat.mtimeMs}:${stat.size}`;
  let entry = preparations.get(path);
  if (!entry || entry.stamp !== stamp || entry.expires < Date.now()) {
    if (preparations.size >= 64) preparations.delete(preparations.keys().next().value!);
    // Remember completion briefly, including an unavailable converter. Otherwise
    // a slow failing probe could start again on every poll and return 202 forever.
    const record = { stamp, expires: Infinity, complete: Promise.resolve(true) };
    record.complete = ensureMobilePlayback(path).then(() => true, () => true)
      .finally(() => { record.expires = Date.now() + 60_000; });
    preparations.set(path, record);
    entry = record;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([entry.complete, new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 250); })])
    .finally(() => clearTimeout(timer));
}

type AccessVideo = { live_status: string; is_short: number; external: number; members_only: number; is_private: number; is_unavailable: number };
export async function nativePlaybackAccess(userId: number, videoId: string): Promise<{ video: AccessVideo; child: ChildStatus } | { error: string; status: 403 | 404 }> {
  const video = await database.prepare("SELECT live_status, is_short, external, members_only, is_private, is_unavailable FROM videos WHERE video_id=?")
    .get<AccessVideo>(videoId);
  if (!video) return { error: "not found", status: 404 as const };
  const child = await childStatus(userId);
  if (child.locked || (child.is_child && (
    (child.hide_shorts && video.is_short === 1) ||
    (child.hide_live && ["live", "upcoming"].includes(video.live_status)) ||
    (child.local_only && video.external === 1)
  ))) return { error: "playback restricted", status: 403 as const };
  return { video, child };
}

/** `preferProgressive`: a client whose HLS stream failed asks for the single progressive stream instead. */
export async function nativePlaybackSource(userId: number, videoId: string, signal: AbortSignal = new AbortController().signal, preferProgressive = false): Promise<
  { kind: NativeMediaKind } | { preparing: true } | { error: string; status: 403 | 404 | 409 | 503 }
> {
  const access = await nativePlaybackAccess(userId, videoId);
  if ("error" in access) return access;
  const download = await getDownload(userId, videoId);
  const local = download?.status === "done" && download.path && existsSync(download.path);
  const archived = tubeArchivistConfigured() && await database.prepare(
    "SELECT 1 FROM tube_archivist_items WHERE video_id=? AND available=1"
  ).get(videoId);
  if (local) {
    // A new AV1/Opus download can need more than one HTTP timeout to convert.
    // Keep AVPlayer away from that unfinished response; its first byte request
    // should receive an already prepared file. The existing cache deduplicates
    // work and preserves the original download.
    if (!await mediaPrepared(download.path!)) return { preparing: true };
    return { kind: "file" };
  }
  if (archived) return { kind: "file" };
  // Server streaming routes disallow child profiles; keep the same boundary.
  if (access.child.is_child) return { error: "playback restricted", status: 403 };
  if (access.video.live_status === "upcoming") return { error: "live playback unavailable", status: 409 };
  if (access.video.members_only || access.video.is_private || access.video.is_unavailable) return { error: "native playback unavailable", status: 409 };
  if (!await ytdlpStatus()) return { error: "native playback unavailable", status: 503 };
  if (access.video.live_status === "live") return { kind: "live-hls" };
  // AVPlayer can combine the H.264/AAC renditions even when YouTube offers no
  // progressive MP4. This path never starts an offline download, including
  // when experimental play-while-downloading is enabled in the web client.
  // Building the playlist here caches the session for the client's request.
  if (preferProgressive) {
    log.info("downloads.native_playback_progressive_requested", { userId, videoId });
    return { kind: "direct" };
  }
  const playlist = await directVideoStreaming.getDirectHlsPlaylist(userId, videoId, "index.m3u8", signal, null);
  const kind = nativeKindForDirectPlaylist(playlist.kind);
  if (kind === "direct") log.info("downloads.native_playback_progressive_fallback", { userId, videoId, reason: playlist.kind });
  return { kind };
}

/** Called in place of ordinary auth only when a media capability is present. */
export async function serveMediaTicket(c: Context, next: Next): Promise<Response | void> {
  c.header("Cache-Control", "private, no-store");
  c.header("Referrer-Policy", "no-referrer");
  const token = c.req.query("media_ticket") ?? "";
  const ticket = mediaTickets.read(token);
  const url = new URL(c.req.url);
  if (!ticket || !ticketAllowsPath(ticket, url.pathname, c.req.method)) return c.json({ error: "invalid media ticket" }, 401);
  const session = await validateSession(ticket.sessionToken);
  if (!session || session.user_id !== ticket.userId) {
    mediaTickets.revoke(token);
    return c.json({ error: "expired media session" }, 401);
  }
  const access = await nativePlaybackAccess(ticket.userId, ticket.videoId);
  if ("error" in access) return c.json({ error: access.error }, access.status);
  c.set("userId", ticket.userId);
  // No administrator authority, cookie profile switching, or other API access.
  await next();
  if (c.res.ok && /(?:mpegurl)/i.test(c.res.headers.get("Content-Type") ?? "")) {
    try {
      const playlist = authorizeHlsPlaylist(await c.res.text(), c.req.url, ticket, token);
      const headers = new Headers(c.res.headers);
      headers.delete("Content-Length");
      headers.delete("ETag");
      c.res = new Response(playlist, { status: 200, headers });
      // Hono merges the previous response's headers in its response setter.
      c.header("Content-Length", undefined);
      c.header("ETag", undefined);
    } catch {
      c.res = c.json({ error: "unsupported media playlist" }, 502);
    }
  }
  c.header("Cache-Control", "private, no-store");
  c.header("Referrer-Policy", "no-referrer");
}
