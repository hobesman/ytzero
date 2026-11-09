import type { Context, Hono } from "hono";
import { bearerSessionToken } from "../deviceSessionAuth";
import { MEDIA_TICKET_TTL_MS, mediaTicketPath } from "../mediaTickets";
import { mediaTickets, nativePlaybackAccess, nativePlaybackSource } from "../nativePlayback";

type Environment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };

export function registerNativePlaybackRoutes(api: Hono<Environment>, currentUserId: (c: Context<Environment>) => number) {
  api.post("/videos/:id/playback-ticket", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const sessionToken = bearerSessionToken(c.req.header("authorization"));
    if (!sessionToken) return c.json({ error: "device session required" }, 401);
    const userId = currentUserId(c);
    const videoId = c.req.param("id");
    const { prefer } = await c.req.json().catch(() => ({}));
    const source = await nativePlaybackSource(userId, videoId, c.req.raw.signal, prefer === "progressive");
    if ("error" in source) return c.json({ error: source.error }, source.status);
    if ("preparing" in source) {
      c.header("Retry-After", "2");
      return c.json({ preparing: true }, 202);
    }
    const ticket = mediaTickets.issue({ userId, videoId, sessionToken, kind: source.kind });
    const path = mediaTicketPath({ videoId, kind: source.kind });
    return c.json({ ticket, url: `${path}${path.includes("?") ? "&" : "?"}media_ticket=${ticket}`, content_type: source.kind === "hls" || source.kind === "direct-hls" || source.kind === "live-hls" ? "hls" : "progressive", expires_in: MEDIA_TICKET_TTL_MS / 1000 });
  });

  api.put("/videos/:id/playback-ticket", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const sessionToken = bearerSessionToken(c.req.header("authorization"));
    const { ticket } = await c.req.json().catch(() => ({}));
    const access = await nativePlaybackAccess(currentUserId(c), c.req.param("id"));
    if ("error" in access) return c.json({ error: access.error }, access.status);
    if (!sessionToken || typeof ticket !== "string" || !mediaTickets.renew(ticket, currentUserId(c), c.req.param("id"), sessionToken)) {
      return c.json({ error: "expired media ticket" }, 401);
    }
    return c.json({ expires_in: MEDIA_TICKET_TTL_MS / 1000 });
  });

  api.delete("/videos/:id/playback-ticket", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const sessionToken = bearerSessionToken(c.req.header("authorization"));
    const { ticket } = await c.req.json().catch(() => ({}));
    const entry = typeof ticket === "string" ? mediaTickets.read(ticket) : null;
    if (entry && entry.userId === currentUserId(c) && entry.videoId === c.req.param("id") && entry.sessionToken === sessionToken) mediaTickets.revoke(ticket);
    return c.json({ ok: true });
  });
}
