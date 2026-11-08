import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-device-downloads-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/deviceDownloadsHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...Bun.env, DB_PATH: resolve(root, "db", "source.db"), AVATAR_DIR: resolve(root, "avatars"), DOWNLOADS_DIR: resolve(root, "downloads"), DOWNLOAD_COOKIES_DIR: resolve(root, "download-cookies") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (code !== 0) throw new Error(`Device downloads harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`No result:\n${stdout}`);
  result = JSON.parse(line.slice(7));
}, 30_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("download to device", () => {
  test("queues a device-only download", () => {
    expect(result.deviceOnlyQueued).toEqual({ status: 200, owner: { source: "device" }, physical: { status: "queued" } });
  });

  test("releases the server copy once the browser has the whole file", () => {
    expect(result.deviceOnlyAfter.body).toBe("device-only bytes");
    expect(result.deviceOnlyAfter.length).toBe(String("device-only bytes".length));
    expect(result.deviceOnlyAfter.owner).toBeNull();
    expect(result.deviceOnlyAfter.physical).toEqual({ status: "deleted" });
    expect(result.deviceOnlyAfter.fileExists).toBe(false);
  });

  test("keeps a server copy the profile already asked for", () => {
    expect(result.keptOwner).toEqual({ source: "manual" });
    expect(result.keptAfter).toEqual({ owner: { source: "manual" }, physical: { status: "done" }, fileExists: true });
  });

  test("a later server request turns a device request into a kept copy", () => {
    expect(result.upgradedOwner).toEqual({ source: "manual" });
  });

  test("releases unfetched device-only copies after a day", () => {
    expect(result.sweep).toEqual({ swept: 1, stale: null, fresh: { source: "device" } });
  });
});
