import type { Context, Hono } from "hono";
import { AUTH_SESSION_TTL_SECONDS, authMethod, authSessionCookie, createSession, sharedAuth } from "../auth";
import { database } from "../database";
import { log } from "../logger";
import { loginClientAddress, loginThrottle } from "../loginThrottle";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

type PasswordLogin = { kind: "ok"; userId: number | null; scope: "account" | "profile" } | { kind: "invalid" } | { kind: "disabled" };

/** Checks a username and password against the active password method. */
async function checkPassword(username: string, password: string): Promise<PasswordLogin> {
  const method = authMethod();
  if (method === "shared") {
    const expectedUser = sharedAuth.username();
    if (expectedUser && username !== expectedUser) return { kind: "invalid" };
    return await sharedAuth.verifyPassword(password) ? { kind: "ok", userId: null, scope: "account" } : { kind: "invalid" };
  }
  if (method === "per_profile") {
    const row = await database.prepare("SELECT id, password_hash FROM users WHERE username = ? COLLATE NOCASE")
      .get<{ id: number; password_hash: string | null }>(username);
    if (!row?.password_hash || !(await sharedAuth.verifyHash(password, row.password_hash))) return { kind: "invalid" };
    return { kind: "ok", userId: row.id, scope: "profile" };
  }
  return { kind: "disabled" };
}

/** Throttled password check shared by the browser login and app sign-in. */
async function attemptPasswordLogin(c: ApiContext): Promise<PasswordLogin | { kind: "throttled"; retryAfter: number }> {
  const { username, password } = await c.req.json().catch(() => ({}));
  const name = String(username ?? "");
  const address = loginClientAddress((header) => c.req.header(header));
  const retryAfter = loginThrottle.retryAfter(address, name);
  if (retryAfter) return { kind: "throttled", retryAfter };
  const result = await checkPassword(name, String(password ?? ""));
  if (result.kind === "invalid") {
    loginThrottle.fail(address, name);
    log.warn("auth.login_failed", { method: authMethod() });
  } else if (result.kind === "ok") loginThrottle.succeed(address, name);
  return result;
}

function rejected(c: ApiContext, result: Exclude<Awaited<ReturnType<typeof attemptPasswordLogin>>, { kind: "ok" }>) {
  if (result.kind === "throttled") {
    c.header("Retry-After", String(result.retryAfter));
    return c.json({ error: "too many attempts", retry_after: result.retryAfter }, 429);
  }
  return result.kind === "disabled" ? c.json({ error: "password login not enabled" }, 400) : c.json({ error: "invalid credentials" }, 401);
}

export function registerPasswordLoginRoutes(api: Api, profileCookie: (id: number) => string): void {
  // The web sign-in: a browser session cookie.
  api.post("/auth/password/login", async (c) => {
    const result = await attemptPasswordLogin(c);
    if (result.kind !== "ok") return rejected(c, result);
    c.header("Set-Cookie", authSessionCookie(await createSession(result.userId, result.scope)));
    if (result.userId !== null) c.header("Set-Cookie", profileCookie(result.userId), { append: true });
    log.info("auth.login", { method: authMethod(), scope: result.scope, id: result.userId ?? undefined });
    return c.json(result.userId === null ? { ok: true } : { ok: true, active_id: result.userId });
  });

  // App sign-in on phones: the same check, answered with a bearer token like a
  // completed device pairing, so the app never handles a browser cookie.
  api.post("/auth/device/password", async (c) => {
    c.header("Cache-Control", "no-store");
    const result = await attemptPasswordLogin(c);
    if (result.kind !== "ok") return rejected(c, result);
    const accessToken = await createSession(result.userId, result.scope);
    log.info("auth.device_password_login", { method: authMethod(), scope: result.scope, id: result.userId ?? undefined });
    return c.json({ access_token: accessToken, token_type: "Bearer", expires_in: AUTH_SESSION_TTL_SECONDS });
  });
}
