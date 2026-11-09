import { AsyncLocalStorage } from "node:async_hooks";

const anonymous = new AsyncLocalStorage<true>();

/**
 * Runs background YouTube scraping without a profile's account cookies: the
 * requests carry no session cookies, and their responses neither rotate a
 * profile's cookie jar nor change whether YouTube recognizes it. Public pages
 * (a channel's /live and /streams tabs) need no account, and sending one on
 * every scheduled check is a steady stream of signed-in traffic.
 *
 * The profile's language still applies.
 */
export function withoutProfileCookies<T>(work: () => Promise<T>): Promise<T> {
  return anonymous.run(true, work);
}

export function profileCookiesSuppressed(): boolean {
  return anonymous.getStore() === true;
}
