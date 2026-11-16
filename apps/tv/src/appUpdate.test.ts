import { describe, expect, test } from "bun:test";
import {
  assetSha256, downloadFraction, fetchLatestAndroidRelease, installedBuild, isUpdate, latestAndroidRelease, releaseRepository, shouldDownloadInBackground,
} from "./appUpdate";

const hex = "6babff756a0ee7612bf85b2e666878b27ddf1dc6985834a197e143826b3f6913";

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag, draft: false, prerelease: false, html_url: `https://github.com/o/r/releases/tag/${tag}`,
  assets: [{ name: `ytzero-${tag}.apk`, browser_download_url: `https://github.com/o/r/releases/download/${tag}/ytzero-${tag}.apk` }],
  ...extra,
});

describe("installedBuild", () => {
  test("reads a positive build number", () => expect(installedBuild("123")).toBe(123));
  test("treats a missing or invalid value as a local build", () => {
    expect(installedBuild(undefined)).toBeNull();
    expect(installedBuild("")).toBeNull();
    expect(installedBuild("0")).toBeNull();
    expect(installedBuild("1.5")).toBeNull();
  });
});

describe("releaseRepository", () => {
  test("falls back to the fork", () => {
    expect(releaseRepository(undefined)).toBe("hobesman/ytzero");
    expect(releaseRepository("not a repo")).toBe("hobesman/ytzero");
  });
  test("uses the workflow's repository", () => expect(releaseRepository("someone/ytzero")).toBe("someone/ytzero"));
});

describe("latestAndroidRelease", () => {
  test("picks the highest Android build", () => {
    const latest = latestAndroidRelease([release("android-104"), release("android-110"), release("android-107")]);
    expect(latest?.build).toBe(110);
    expect(latest?.apkUrl).toBe("https://github.com/o/r/releases/download/android-110/ytzero-android-110.apk");
    expect(latest?.pageUrl).toBe("https://github.com/o/r/releases/tag/android-110");
  });
  test("skips drafts, prereleases, other tags and releases without an APK", () => {
    expect(latestAndroidRelease([
      release("android-120", { prerelease: true }),
      release("android-121", { draft: true }),
      release("v2.0.0"),
      release("android-122", { assets: [{ name: "notes.txt", browser_download_url: "https://example.com/notes.txt" }] }),
      release("android-101"),
    ])?.build).toBe(101);
  });
  test("handles an unexpected response", () => {
    expect(latestAndroidRelease({ message: "rate limited" })).toBeNull();
    expect(latestAndroidRelease([null, 4])).toBeNull();
  });
});

describe("release checksums", () => {
  test("reads the APK's SHA-256 from GitHub's digest", () => {
    const latest = latestAndroidRelease([release("android-110", { assets: [{ name: "ytzero-android-110.apk",
      browser_download_url: "https://github.com/o/r/releases/download/android-110/ytzero-android-110.apk", digest: `sha256:${hex.toUpperCase()}` }] })]);
    expect(latest?.sha256).toBe(hex);
  });
  test("has none when GitHub lists none or another kind", () => {
    expect(latestAndroidRelease([release("android-110")])?.sha256).toBeNull();
    expect(assetSha256(`sha1:${hex.slice(0, 40)}`)).toBeNull();
    expect(assetSha256(`sha256:${hex.slice(1)}`)).toBeNull();
    expect(assetSha256(42)).toBeNull();
  });
});

describe("background download", () => {
  test("waits for Wi-Fi, the setting and an idle updater", () => {
    expect(shouldDownloadInBackground({ auto: true, metered: false, idle: true })).toBe(true);
    expect(shouldDownloadInBackground({ auto: true, metered: true, idle: true })).toBe(false);
    expect(shouldDownloadInBackground({ auto: false, metered: false, idle: true })).toBe(false);
    expect(shouldDownloadInBackground({ auto: true, metered: false, idle: false })).toBe(false);
  });
  test("reports progress once the size is known", () => {
    expect(downloadFraction({ downloaded: 25, total: 100 })).toBe(0.25);
    expect(downloadFraction({ downloaded: 5, total: -1 })).toBeNull();
    expect(downloadFraction({ downloaded: 120, total: 100 })).toBe(1);
  });
});

describe("isUpdate", () => {
  const latest = latestAndroidRelease([release("android-110")]);
  test("compares build numbers", () => {
    expect(isUpdate(latest, 109)).toBe(true);
    expect(isUpdate(latest, 110)).toBe(false);
    expect(isUpdate(latest, 111)).toBe(false);
  });
  test("offers any release to a local build", () => expect(isUpdate(latest, null)).toBe(true));
  test("offers nothing without a release", () => expect(isUpdate(null, null)).toBe(false));
});

describe("fetchLatestAndroidRelease", () => {
  test("asks the repository's releases", async () => {
    let url = "";
    const fetcher = (async (input: string) => { url = input; return Response.json([release("android-105")]); }) as unknown as typeof fetch;
    expect((await fetchLatestAndroidRelease(fetcher, "o/r"))?.build).toBe(105);
    expect(url).toBe("https://api.github.com/repos/o/r/releases?per_page=30");
  });
  test("fails on an error response", async () => {
    const fetcher = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;
    await expect(fetchLatestAndroidRelease(fetcher, "o/r")).rejects.toThrow("403");
  });
});
