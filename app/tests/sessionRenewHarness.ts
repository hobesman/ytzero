const { api } = await import("../src/routes");
const { AUTH_SESSION_COOKIE } = await import("../src/auth");
const { database } = await import("../src/database");
const { db, setSetting } = await import("../src/db");

await setSetting("auth_method", "per_profile");
db.prepare("UPDATE users SET username = ?, password_hash = ? WHERE id = 1").run("nick", await Bun.password.hash("correct horse"));

const login = await api.request("http://localhost/auth/password/login", {
  method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.9" },
  body: JSON.stringify({ username: "nick", password: "correct horse" }),
});
const token = decodeURIComponent(/ytzero_session=([^;]+)/.exec(login.headers.get("set-cookie") ?? "")?.[1] ?? "");
// Make the session nearly expired, as a tablet's would be after 29 days.
const soon = new Date(Date.now() + 60_000).toISOString();
await database.prepare("UPDATE auth_sessions SET expires_at = ? WHERE token = ?").run(soon, token);

const renew = (cookie?: string) => api.request("http://localhost/auth/session/renew", { method: "POST", headers: cookie ? { cookie } : {} });
const renewed = await renew(`${AUTH_SESSION_COOKIE}=${encodeURIComponent(token)}`);
const renewedCookie = renewed.headers.get("set-cookie") ?? "";
const row = await database.prepare("SELECT expires_at FROM auth_sessions WHERE token = ?").get<{ expires_at: string }>(token);
const anonymous = await renew();
const forged = await renew(`${AUTH_SESSION_COOKIE}=00000000-0000-4000-8000-000000000000`);

if (
  login.status !== 200 || !token
  || renewed.status !== 200
  || !renewedCookie.includes(`${AUTH_SESSION_COOKIE}=`) || !renewedCookie.includes("Max-Age=2592000") || !renewedCookie.includes("HttpOnly")
  || !row || Date.parse(row.expires_at) < Date.now() + 29 * 24 * 60 * 60 * 1000
  || anonymous.status !== 401 || forged.status !== 401
) {
  console.error(JSON.stringify({ login: login.status, renewed: renewed.status, renewedCookie, row, anonymous: anonymous.status, forged: forged.status }));
  throw new Error("session renew assertion failed");
}
console.log("RESULT session renew");
