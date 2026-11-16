// Copies a YT Zero server's app name and icon color into branding.json, which
// the brand assets and the app's name are built from.
//
//   bun scripts/fetch-branding.ts https://tube.example.com
//
// The address may also come from YTZERO_BRANDING_URL. Without one, or when the
// server can't be reached, branding.json is left as it is, so a build never
// fails because the server is down.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brandingFromServer, normalizeBranding } from "../src/branding";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "branding.json");
const current = normalizeBranding(JSON.parse(await readFile(file, "utf8")));
const address = (process.argv[2] ?? process.env.YTZERO_BRANDING_URL ?? "").trim();

function keep(reason: string): never {
  const prefix = process.env.GITHUB_ACTIONS ? "::warning::" : "";
  console.log(`${prefix}${reason}; building with ${current.name} (${current.color}) from branding.json.`);
  process.exit(0);
}

if (!address) keep("No server address given");

let origin: string;
try {
  const url = new URL(address);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("not http");
  origin = url.origin;
} catch {
  keep("The server address is not an http(s) URL");
}

async function get(path: string): Promise<Response> {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(15_000), redirect: "follow" });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response;
}

let branding: { name: string; color: string } | null;
try {
  const [manifest, favicon] = await Promise.all([
    get("/manifest.webmanifest").then((response) => response.json()),
    get("/favicon.svg").then((response) => response.text()),
  ]);
  branding = brandingFromServer(manifest, favicon);
} catch (error) {
  keep(`Couldn't read the server's branding (${error instanceof Error ? error.message : String(error)})`);
}
if (!branding) keep("The server didn't publish a name and icon color");

await writeFile(file, `${JSON.stringify(branding, null, 2)}\n`);
console.log(`Branding from the server: ${branding.name} (${branding.color}).`);
