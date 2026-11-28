import type { Context, Hono } from "hono";
import { BRIDGE_MAX_START_SECONDS, bridgeVideoStreaming } from "../bridgeVideoStreaming";
import { bearerSessionToken } from "../deviceSessionAuth";
import { MEDIA_TICKET_TTL_MS, mediaTicketPath } from "../mediaTickets";
import { mediaTickets, nativePlaybackAccess, nativePlaybackSource } from "../nativePlayback";
import { parseDirectStreamQuality } from "../downloadVideoDirectStreaming";

type Environment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };

export function registerNativePlaybackRoutes(api: Hono<Environment>, currentUserId: (c: Context<Environment>) => number) {
  api.post("/videos/:id/playback-ticket", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const sessionToken = bearerSessionToken(c.req.header("authorization"));
    if (!sessionToken) return c.json({ error: "device session required" }, 401);
    const userId = currentUserId(c);
    const videoId = c.req.param("id");
    const { prefer, quality: requested, bridge: wantsBridge, position } = await c.req.json().catch(() => ({}));
    const quality = parseDirectStreamQuality(requested);
    // The bridge serves only about the first minute, so it is offered only from about the start.
    const bridge = wantsBridge === true && (typeof position !== "number" || position <= BRIDGE_MAX_START_SECONDS);
    const source = await nativePlaybackSource(userId, videoId, c.req.raw.signal, prefer === "progressive", quality, bridge);
    if ("error" in source) return c.json({ error: source.error }, source.status);
    if ("preparing" in source) {
      c.header("Retry-After", "2");
      return c.json({ preparing: true }, 202);
    }
    const ticket = mediaTickets.issue({ userId, videoId, sessionToken, kind: source.kind });
    const base = mediaTicketPath({ videoId, kind: source.kind });
    // The quality rides on the master playlist URL; its child URIs carry it on.
    const path = source.kind === "direct-hls" && quality ? `${base}?q=${quality}` : base;
    return c.json({
      ticket, url: `${path}${path.includes("?") ? "&" : "?"}media_ticket=${ticket}`,
      content_type: source.kind === "hls" || source.kind === "direct-hls" || source.kind === "live-hls" ? "hls" : "progressive",
      expires_in: MEDIA_TICKET_TTL_MS / 1000,
      // A stopgap: the client asks again without `bridge` and switches once that is ready.
      ...(source.kind === "bridge" ? { bridge: true } : {}),
    });
  });

  // The fast-start bridge's media, reached only with a "bridge" media ticket.
  api.get("/videos/:id/bridge-stream", async (c) => {
    const userId = currentUserId(c);
    const videoId = c.req.param("id");
    const access = await nativePlaybackAccess(userId, videoId);
    if ("error" in access) return c.json({ error: access.error }, access.status);
    if (access.child.is_child) return c.json({ error: "not allowed" }, 403);
    const response = await bridgeVideoStreaming.getDirectVideoResponse(userId, videoId, c.req.header("range") ?? null, c.req.raw.signal);
    return response ?? c.json({ error: "bridge stream unavailable" }, 502);
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
    if (sessionToken && typeof ticket === "string" && mediaTickets.owned(ticket, currentUserId(c), c.req.param("id"), sessionToken)) mediaTickets.revoke(ticket);
    return c.json({ ok: true });
  });
}
