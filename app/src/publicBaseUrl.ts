/** The address public links are built on: APP_URL (origin plus any path
 * prefix, no trailing slash) when it is set and valid, else the origin of the
 * request being answered. */
export function publicBaseUrl(requestUrl: string, appUrl: string | undefined = process.env.APP_URL): string {
  const configured = appUrl?.trim().replace(/\/+$/, "");
  if (configured) {
    try {
      const parsed = new URL(configured);
      return parsed.origin + parsed.pathname.replace(/\/$/, "");
    } catch {}
  }
  return new URL(requestUrl).origin;
}
