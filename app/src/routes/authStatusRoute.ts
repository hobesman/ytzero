import type { Context, Hono } from "hono";
import { authMethod, hasPasskeys, proxyHeaderValue, resolveProxyUser, sharedAuth, validateSession } from "../auth";
import { database } from "../database";
import { getSetting } from "../db";
import { publicBrand } from "../publicBrand";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

interface AuthStatusRouteAccess {
  canDelegateProfileAdmins: () => boolean;
  canSwitchProfiles: () => boolean;
  hideOtherProfilesInPicker: () => boolean;
  isAdmin: (context: ApiContext) => boolean;
  isPrimaryUser: (context: ApiContext) => boolean;
  sessionToken: (context: ApiContext) => string | undefined;
}

export function registerAuthStatusRoute(api: Api, access: AuthStatusRouteAccess): void {
  api.get("/auth/status", async (c) => {
    const method = authMethod();
    const ownerCapabilities = {
      can_manage_administrators: access.isPrimaryUser(c),
      admin_delegation_available: access.canDelegateProfileAdmins(),
    };
    if (c.req.header("authorization")?.match(/^Bearer\s/i)) {
      const deviceSession = await validateSession(access.sessionToken(c));
      const canSwitch = Boolean(deviceSession && access.canSwitchProfiles());
      return c.json({
        method,
        authenticated: Boolean(deviceSession),
        scope: deviceSession?.scope ?? null,
        can_switch: canSwitch,
        hide_other_profiles: canSwitch ? access.hideOtherProfilesInPicker() : true,
        is_admin: access.isAdmin(c),
        ...ownerCapabilities,
      });
    }
    if (method === "none") return c.json({ method, authenticated: true, can_switch: true, hide_other_profiles: false, is_admin: access.isAdmin(c), ...ownerCapabilities });

    if (method === "proxy_header") {
      const uid = await resolveProxyUser(c);
      return c.json({
        method,
        authenticated: Boolean(uid),
        can_switch: false,
        hide_other_profiles: access.hideOtherProfilesInPicker(),
        is_admin: access.isAdmin(c),
        ...ownerCapabilities,
        proxy_header_seen: Boolean(proxyHeaderValue(c)),
        brand: publicBrand(),
      });
    }

    const session = await validateSession(access.sessionToken(c));
    const perProfilePasskeys =
      (await database.prepare("SELECT COUNT(*) AS n FROM webauthn_credentials WHERE user_id IS NOT NULL").get() as { n: number }).n > 0;
    return c.json({
      method,
      authenticated: Boolean(session),
      scope: session?.scope ?? null,
      can_switch: access.canSwitchProfiles(),
      hide_other_profiles: access.hideOtherProfilesInPicker(),
      is_admin: access.isAdmin(c),
      ...ownerCapabilities,
      oidc_mode: method === "oidc" ? getSetting("auth_oidc_mode") || "mapped" : undefined,
      // per_profile always needs a username; shared only when one was configured.
      username_field: method === "per_profile" || (method === "shared" && Boolean(sharedAuth.username())),
      login: {
        password: method === "shared" ? sharedAuth.passwordConfigured() : method === "per_profile",
        passkey: method === "shared" ? await hasPasskeys(null) : method === "per_profile" ? perProfilePasskeys : false,
        oidc: method === "oidc",
      },
      // For the sign-in page, which can't read settings yet.
      brand: publicBrand(),
    });
  });
}
