import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test("a signed-in browser extends its own session, and nobody else can", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-session-renew-"));
  try {
    const child = Bun.spawn([process.execPath, "app/tests/sessionRenewHarness.ts"], {
      cwd: resolve(import.meta.dir, "../.."),
      env: { ...Bun.env, DB_PATH: resolve(root, "db", "test.db"), AVATAR_DIR: resolve(root, "avatars"), DOWNLOADS_DIR: resolve(root, "downloads") },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`Session renew harness failed:\n${stdout}\n${stderr}`);
    expect(stdout).toContain("RESULT session renew");
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);
