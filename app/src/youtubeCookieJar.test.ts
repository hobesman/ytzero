import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_YOUTUBE_COOKIE_JAR_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("YouTube cookie jar suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/youtubeCookieJar.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(join(tmpdir(), "ytzero-cookie-jar-"));
  process.env.DB_PATH = resolve(root, "db.sqlite");
  process.env.DOWNLOAD_COOKIES_DIR = resolve(root, "download-cookies");

  const { downloadCookiesFile } = await import("./downloadConfig");
  const {
    detectYouTubeCookieRecognition,
    invalidateYouTubeCookieHealth,
    mergeYouTubeSetCookies,
    readYouTubeBodyWithCookies,
    readYouTubeResponseWithCookies,
    refreshYouTubeCookieFile,
    refreshYouTubeResponseCookies,
    youtubeCookieHealth,
  } = await import("./youtubeCookieJar");

  const PROFILE = 1;
  const JAR = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2208988800\tSID\taccount-session\n";

  function writeJar(): string {
    const path = downloadCookiesFile(PROFILE);
    writeFileSync(path, JAR, { mode: 0o600 });
    invalidateYouTubeCookieHealth(PROFILE);
    return path;
  }

  const VISITOR_COOKIE = "SID=stranger-visitor; Domain=.youtube.com; Path=/; Expires=Sun, 1 Jan 2040 00:00:00 GMT; Secure";

  function youtubeResponse(body: string | null, status = 200): Response {
    const headers = new Headers();
    headers.append("set-cookie", VISITOR_COOKIE);
    return new Response(body, { status, headers });
  }

  function jarOnDisk(): string {
    return readFileSync(downloadCookiesFile(PROFILE), "utf8");
  }

  const temporaryDirectories: string[] = [];
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe("YouTube cookie jar rotation", () => {
    test("merges YouTube cookies while preserving HttpOnly and unrelated domains", () => {
      const jar = [
        "# Netscape HTTP Cookie File",
        "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t2208988800\tSID\told",
        ".google.com\tTRUE\t/\tTRUE\t2208988800\tOTHER\tpreserve-me",
        "",
      ].join("\n");
      const result = mergeYouTubeSetCookies(jar, [
        "SID=new; Domain=.youtube.com; Path=/; Expires=Sun, 1 Jan 2040 00:00:00 GMT; Secure; HttpOnly",
        "PREF=hl=en; Domain=.youtube.com; Path=/; Max-Age=600; Secure",
        "OTHER=do-not-import; Domain=.google.com; Path=/; Secure",
      ], "https://www.youtube.com/watch?v=abcdefghijk", 2_000_000_000);

      expect(result.updates).toBe(2);
      expect(result.contents).toContain("#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t2208988800\tSID\tnew");
      expect(result.contents).toContain(".youtube.com\tTRUE\t/\tTRUE\t2000000600\tPREF\thl=en");
      expect(result.contents).toContain(".google.com\tTRUE\t/\tTRUE\t2208988800\tOTHER\tpreserve-me");
      expect(result.contents).not.toContain("do-not-import");
      expect(result.contents.endsWith("\n")).toBe(true);
    });

    test("removes expired cookies and leaves an identical jar untouched", () => {
      const jar = [
        "# Netscape HTTP Cookie File",
        ".youtube.com\tTRUE\t/\tTRUE\t2208988800\tSID\tcurrent",
      ].join("\n");
      const unchanged = mergeYouTubeSetCookies(jar, [
        "SID=current; Domain=.youtube.com; Path=/; Expires=Sun, 1 Jan 2040 00:00:00 GMT; Secure",
      ], "https://www.youtube.com/", 2_000_000_000);
      expect(unchanged).toEqual({ contents: jar, updates: 0 });

      const removed = mergeYouTubeSetCookies(jar, [
        "SID=; Domain=.youtube.com; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure",
      ], "https://www.youtube.com/", 2_000_000_000);
      expect(removed.updates).toBe(1);
      expect(removed.contents).not.toContain("\tSID\t");
    });

    test("ignores an unchanged cookie whose Max-Age only moved its expiry", () => {
      const jar = [
        "# Netscape HTTP Cookie File",
        ".youtube.com\tTRUE\t/\tTRUE\t2015552000\tVISITOR_INFO1_LIVE\tsame",
        "",
      ].join("\n");
      const header = "VISITOR_INFO1_LIVE=same; Domain=.youtube.com; Path=/; Max-Age=15552000; Secure";
      // A second later, and an hour later: the same cookie, a slightly later expiry.
      expect(mergeYouTubeSetCookies(jar, [header], "https://www.youtube.com/", 2_000_000_001).updates).toBe(0);
      expect(mergeYouTubeSetCookies(jar, [header], "https://www.youtube.com/", 2_000_003_600).updates).toBe(0);
      // A new value, or an expiry moved by days, is still written.
      expect(mergeYouTubeSetCookies(jar, [header.replace("=same", "=rotated")], "https://www.youtube.com/", 2_000_000_001).updates).toBe(1);
      expect(mergeYouTubeSetCookies(jar, [header], "https://www.youtube.com/", 2_000_200_000).updates).toBe(1);
    });

    test("rejects non-YouTube and insecure request origins", () => {
      const jar = "# Netscape HTTP Cookie File\n";
      expect(mergeYouTubeSetCookies(jar, ["SID=x; Domain=.youtube.com"], "https://example.com/").updates).toBe(0);
      expect(mergeYouTubeSetCookies(jar, ["SID=x; Domain=.youtube.com"], "http://www.youtube.com/").updates).toBe(0);
    });

    test("atomically replaces a changed jar with private file permissions", () => {
      const directory = mkdtempSync(join(tmpdir(), "ytzero-cookie-"));
      temporaryDirectories.push(directory);
      const path = join(directory, "cookies.txt");
      writeFileSync(path, "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2208988800\tSID\told\n", { mode: 0o644 });

      expect(refreshYouTubeCookieFile(path, [
        "SID=new; Domain=.youtube.com; Path=/; Expires=Sun, 1 Jan 2040 00:00:00 GMT; Secure",
      ], "https://www.youtube.com/")).toBe(1);
      expect(readFileSync(path, "utf8")).toContain("\tSID\tnew");
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(readdirSync(directory)).toEqual(["cookies.txt"]);
    });
  });

  describe("YouTube cookie recognition", () => {
    test("accepts each explicit signed-in marker", () => {
      expect(detectYouTubeCookieRecognition('{"LOGGED_IN":true}')).toBe(true);
      expect(detectYouTubeCookieRecognition('{"mainAppWebResponseContext":{"loggedOut":false}}')).toBe(true);
      expect(detectYouTubeCookieRecognition('{"key":"logged_in","value":"1"}')).toBe(true);
    });

    test("accepts explicit signed-out markers and otherwise stays unknown", () => {
      expect(detectYouTubeCookieRecognition('{"LOGGED_IN":false}')).toBe(false);
      expect(detectYouTubeCookieRecognition('{"mainAppWebResponseContext":{"loggedOut":true}}')).toBe(false);
      expect(detectYouTubeCookieRecognition('{"key":"logged_in","value":"0"}')).toBe(false);
      expect(detectYouTubeCookieRecognition("temporary upstream error")).toBeNull();
    });
  });

  describe("YouTube cookie jar and account recognition", () => {
    test("leaves a jar YouTube no longer recognizes exactly as it was exported", async () => {
      writeJar();
      const body = '{"LOGGED_IN":false}';

      expect(await readYouTubeBodyWithCookies(youtubeResponse(body), PROFILE, "https://www.youtube.com/")).toBe(body);
      expect(jarOnDisk()).toBe(JAR);
      expect((await youtubeCookieHealth(PROFILE)).recognition).toBe("unrecognized");
    });

    test("merges rotation while YouTube still recognizes the account", async () => {
      writeJar();
      const body = '{"LOGGED_IN":true}';

      await readYouTubeBodyWithCookies(youtubeResponse(body), PROFILE, "https://www.youtube.com/");
      expect(jarOnDisk()).toContain("\tSID\tstranger-visitor");
      expect((await youtubeCookieHealth(PROFILE)).recognition).toBe("recognized");
    });

    test("still merges rotation from a response that answers neither way", async () => {
      writeJar();

      await readYouTubeBodyWithCookies(youtubeResponse("temporary upstream error"), PROFILE, "https://www.youtube.com/");
      expect(jarOnDisk()).toContain("\tSID\tstranger-visitor");
    });

    test("keeps the jar when a rejected response also disowns the account", async () => {
      writeJar();
      const response = youtubeResponse('{"LOGGED_IN":false}', 500);

      await expect(readYouTubeResponseWithCookies(response, "channel page failed", PROFILE, "https://www.youtube.com/"))
        .rejects.toThrow("channel page failed (500)");
      expect(jarOnDisk()).toBe(JAR);
    });

    test("still persists rotation before rejecting a response the account was recognized by", async () => {
      writeJar();
      const response = youtubeResponse('{"LOGGED_IN":true}', 500);

      await expect(readYouTubeResponseWithCookies(response, "channel page failed", PROFILE, "https://www.youtube.com/"))
        .rejects.toThrow("channel page failed (500)");
      expect(jarOnDisk()).toContain("\tSID\tstranger-visitor");
    });

    test("refuses a bodiless response once an answer has disowned the jar", async () => {
      writeJar();

      // A HEAD request, as the Shorts classifier makes, carries cookies but no answer.
      expect(refreshYouTubeResponseCookies(youtubeResponse(null), PROFILE, "https://www.youtube.com/shorts/x")).toBe(1);
      expect(jarOnDisk()).toContain("\tSID\tstranger-visitor");

      writeJar();
      await readYouTubeBodyWithCookies(youtubeResponse('{"LOGGED_IN":false}'), PROFILE, "https://www.youtube.com/");
      expect(refreshYouTubeResponseCookies(youtubeResponse(null), PROFILE, "https://www.youtube.com/shorts/x")).toBe(0);
      expect(jarOnDisk()).toBe(JAR);
    });

    test("keeps refusing after a health probe fails to reach YouTube", async () => {
      writeJar();
      await readYouTubeBodyWithCookies(youtubeResponse('{"LOGGED_IN":false}'), PROFILE, "https://www.youtube.com/");

      const original = globalThis.fetch;
      globalThis.fetch = (() => Promise.reject(new Error("network unreachable"))) as unknown as typeof fetch;
      try {
        // Past the health TTL, so the settings page probes again and gets nothing.
        expect((await youtubeCookieHealth(PROFILE, Date.now() + 20 * 60_000)).recognition).toBe("unknown");
      } finally {
        globalThis.fetch = original;
      }

      expect(refreshYouTubeResponseCookies(youtubeResponse(null), PROFILE, "https://www.youtube.com/shorts/x")).toBe(0);
      expect(jarOnDisk()).toBe(JAR);
    });

    test("resumes merging once the profile uploads a jar again", async () => {
      writeJar();
      await readYouTubeBodyWithCookies(youtubeResponse('{"LOGGED_IN":false}'), PROFILE, "https://www.youtube.com/");
      expect(jarOnDisk()).toBe(JAR);

      writeJar();
      await readYouTubeBodyWithCookies(youtubeResponse("temporary upstream error"), PROFILE, "https://www.youtube.com/");
      expect(jarOnDisk()).toContain("\tSID\tstranger-visitor");
    });
  });
}
