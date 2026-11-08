const { api } = await import("../src/routes");
const { AUTH_SESSION_TTL_SECONDS } = await import("../src/auth");
const { db, setSetting } = await import("../src/db");
const { LOGIN_FAILURES_PER_USERNAME } = await import("../src/loginThrottle");

const signIn = (username: string, password: string, address: string, path = "/auth/device/password") => api.request(`http://localhost${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Forwarded-For": address },
  body: JSON.stringify({ username, password }),
});

await setSetting("auth_method", "none");
const disabled = await signIn("nick", "secret", "198.51.100.1");

await setSetting("auth_method", "per_profile");
db.prepare("UPDATE users SET username = ?, password_hash = ? WHERE id = 1").run("nick", await Bun.password.hash("correct horse"));

const wrong = await signIn("nick", "nope", "198.51.100.2");
const right = await signIn("Nick", "correct horse", "198.51.100.2");
const rightBody = await right.json() as any;
const status = await api.request("http://localhost/auth/status", { headers: { Authorization: `Bearer ${rightBody.access_token}` } });
const statusBody = await status.json() as any;

// Repeated failures lock that username from that address, even with the right password.
for (let attempt = 0; attempt < LOGIN_FAILURES_PER_USERNAME; attempt++) await signIn("nick", "guess", "198.51.100.3");
const locked = await signIn("nick", "correct horse", "198.51.100.3");
const otherAddress = await signIn("nick", "correct horse", "198.51.100.4");
// The browser sign-in shares the same check and limit.
const lockedWeb = await signIn("nick", "correct horse", "198.51.100.3", "/auth/password/login");
const web = await signIn("nick", "correct horse", "198.51.100.5", "/auth/password/login");

if (
  disabled.status !== 400
  || wrong.status !== 401
  || right.status !== 200
  || right.headers.get("cache-control") !== "no-store"
  || typeof rightBody.access_token !== "string" || !rightBody.access_token
  || rightBody.token_type !== "Bearer"
  || rightBody.expires_in !== AUTH_SESSION_TTL_SECONDS
  || right.headers.get("set-cookie") !== null
  || status.status !== 200
  || statusBody.authenticated !== true
  || statusBody.scope !== "profile"
  || locked.status !== 429
  || !Number(locked.headers.get("retry-after"))
  || otherAddress.status !== 200
  || lockedWeb.status !== 429
  || web.status !== 200
  || !web.headers.get("set-cookie")
) {
  console.error(JSON.stringify({
    disabled: disabled.status, wrong: wrong.status, right: right.status, rightBody, status: status.status, statusBody,
    locked: locked.status, otherAddress: otherAddress.status, lockedWeb: lockedWeb.status, web: web.status,
  }));
  throw new Error("device password sign-in assertion failed");
}
console.log("RESULT device password sign-in");
