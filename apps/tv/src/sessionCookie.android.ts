import { NativeModule, requireOptionalNativeModule } from "expo";

declare class SessionCookieModule extends NativeModule {
  setSessionCookie(url: string, token: string | null): Promise<boolean>;
}

const native = requireOptionalNativeModule<SessionCookieModule>("YtZeroSessionCookie");

/**
 * Android's image pipeline drops the Authorization header on thumbnail
 * requests. It shares the system cookie store with fetch, and the instance
 * accepts the same session as its cookie, so images authenticate this way.
 */
export async function setSessionCookie(instanceUrl: string, token: string | null): Promise<void> {
  await native?.setSessionCookie(instanceUrl, token);
}
