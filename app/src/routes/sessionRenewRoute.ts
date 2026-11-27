import type { Context, Hono } from "hono";
import { AUTH_SESSION_TTL_SECONDS, authMethod, authSessionCookie, validateSession } from "../auth";
import { bearerSessionToken } from "../deviceSessionAuth";

type ApiEnvironment = { Variables: { userId: number } };
type ApiContext = Context<ApiEnvironment>;

/**
 * Extends the browser's sign-in by another full session lifetime. A browser
 * session otherwise ends 30 days after it signs in, which is right for a
 * person's browser but not for a wall tablet that should stay signed in for
 * months: the room page calls this once a day. Only a session that is still
 * valid can extend itself, as a device's bearer session already does on every
 * request.
 */
export function registerSessionRenewRoute(api: Hono<ApiEnvironment>, access: { sessionToken: (context: ApiContext) => string | undefined }): void {
  api.post("/auth/session/renew", async (context) => {
    context.header("Cache-Control", "no-store");
    const method = authMethod();
    // No sign-in to keep (none), or the proxy owns it (proxy_header).
    if (method === "none" || method === "proxy_header") return context.json({ ok: true, renewed: false });
    const token = access.sessionToken(context);
    const session = await validateSession(token, { renew: true });
    if (!token || !session) return context.json({ error: "unauthenticated" }, 401);
    if (!bearerSessionToken(context.req.header("authorization"))) context.header("Set-Cookie", authSessionCookie(token));
    return context.json({ ok: true, renewed: true, expiresIn: AUTH_SESSION_TTL_SECONDS });
  });
}
