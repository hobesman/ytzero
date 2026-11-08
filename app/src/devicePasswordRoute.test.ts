import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test("phones sign in with a username and password, with failed attempts limited", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-device-password-"));
  try {
    const child = Bun.spawn([process.execPath, "app/tests/devicePasswordHarness.ts"], {
      cwd: resolve(import.meta.dir, "../.."),
      env: { ...Bun.env, DB_PATH: resolve(root, "db", "test.db"), AVATAR_DIR: resolve(root, "avatars"), DOWNLOADS_DIR: resolve(root, "downloads") },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`Device password harness failed:\n${stdout}\n${stderr}`);
    expect(stdout).toContain("RESULT device password sign-in");
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);
