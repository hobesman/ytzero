/**
 * Android phone builds come from the "Android APK" GitHub workflow, which
 * publishes each one as a release tagged `android-<build>` with the APK
 * attached. The build number is the APK's versionCode and is inlined into the
 * bundle as EXPO_PUBLIC_ANDROID_BUILD; a build made by hand has none.
 */
export type AndroidRelease = {
  build: number; tag: string; apkUrl: string; pageUrl: string;
  /** The APK's SHA-256 (lowercase hex) as GitHub lists it; without one the app won't install it itself. */
  sha256: string | null;
};

const defaultRepository = "hobesman/ytzero";
const tagPattern = /^android-(\d+)$/;

/** The installed build number, or null for a build made outside the workflow. */
export function installedBuild(value: string | undefined = process.env.EXPO_PUBLIC_ANDROID_BUILD): number | null {
  const build = Number(value);
  return Number.isSafeInteger(build) && build > 0 ? build : null;
}

export function releaseRepository(value: string | undefined = process.env.EXPO_PUBLIC_UPDATE_REPOSITORY): string {
  return value && /^[\w.-]+\/[\w.-]+$/.test(value) ? value : defaultRepository;
}

type GitHubRelease = {
  tag_name?: unknown; draft?: unknown; prerelease?: unknown; html_url?: unknown;
  assets?: Array<{ name?: unknown; browser_download_url?: unknown; digest?: unknown }>;
};

const digestPattern = /^sha256:([0-9a-f]{64})$/i;

/** GitHub's "sha256:<hex>" asset digest as lowercase hex, or null. */
export function assetSha256(digest: unknown): string | null {
  const match = typeof digest === "string" ? digestPattern.exec(digest) : null;
  return match ? match[1]!.toLowerCase() : null;
}

/** The newest published (not draft, not prerelease) Android release in a GitHub releases listing. */
export function latestAndroidRelease(releases: unknown): AndroidRelease | null {
  if (!Array.isArray(releases)) return null;
  let latest: AndroidRelease | null = null;
  for (const release of releases as GitHubRelease[]) {
    if (!release || release.draft === true || release.prerelease === true || typeof release.tag_name !== "string") continue;
    const match = tagPattern.exec(release.tag_name);
    if (!match) continue;
    const apk = release.assets?.find((asset) => typeof asset.name === "string" && asset.name.endsWith(".apk")
      && typeof asset.browser_download_url === "string" && asset.browser_download_url.startsWith("https://"));
    if (!apk) continue;
    const build = Number(match[1]);
    if (latest && latest.build >= build) continue;
    latest = { build, tag: release.tag_name, apkUrl: apk.browser_download_url as string,
      pageUrl: typeof release.html_url === "string" ? release.html_url : apk.browser_download_url as string, sha256: assetSha256(apk.digest) };
  }
  return latest;
}

/** A build made by hand has no number, so any published build counts as newer. */
export function isUpdate(release: AndroidRelease | null, installed: number | null): release is AndroidRelease {
  return release !== null && (installed === null || release.build > installed);
}

/** The background download starts only when it's on, the phone is off mobile data, and nothing else is under way. */
export function shouldDownloadInBackground(options: { auto: boolean; metered: boolean; idle: boolean }): boolean {
  return options.auto && !options.metered && options.idle;
}

/** The share of a download done, 0 to 1, or null while the size isn't known. */
export function downloadFraction(progress: { downloaded: number; total: number }): number | null {
  return progress.total > 0 ? Math.min(1, Math.max(0, progress.downloaded / progress.total)) : null;
}

export async function fetchLatestAndroidRelease(fetcher: typeof fetch = fetch, repository = releaseRepository()): Promise<AndroidRelease | null> {
  const response = await fetcher(`https://api.github.com/repos/${repository}/releases?per_page=30`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub releases: ${response.status}`);
  return latestAndroidRelease(await response.json());
}
