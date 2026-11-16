import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { buildBranding } from "../src/branding";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "assets", "brand");
// The tile color and name come from branding.json; see scripts/fetch-branding.ts.
const blue = buildBranding.color;
const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const background = "#070708";
const playPath = "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z";

function mark(size: number, x: number, y: number, rounded = true): string {
  const radius = rounded ? size * 0.21875 : 0;
  const iconInset = size * 0.21875;
  const iconSize = size * 0.5625;
  return `
    <g>
      <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${radius}" fill="${blue}"/>
      <svg x="${x + iconInset}" y="${y + iconInset}" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="#fff" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="${playPath}"/>
      </svg>
    </g>`;
}

function launcher(size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${mark(size, 0, 0, false)}
  </svg>`;
}

function tvTile(width: number, height: number): string {
  const playSize = Math.round(height * 0.36);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${blue}"/>
    <svg x="${(width - playSize) / 2}" y="${(height - playSize) / 2}" width="${playSize}" height="${playSize}" viewBox="0 0 24 24" fill="#fff" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="${playPath}"/>
    </svg>
  </svg>`;
}

function topShelf(width: number, height: number): string {
  const markSize = Math.round(height * 0.25);
  const gap = Math.round(markSize * 0.32);
  const fontSize = Math.round(markSize * 0.66);
  // "YT Zero" measured 3.25 font sizes wide; other names scale by length.
  const wordWidth = Math.round(fontSize * 3.25 * buildBranding.name.length / 7);
  const groupWidth = markSize + gap + wordWidth;
  const startX = Math.round((width - groupWidth) / 2);
  const startY = Math.round((height - markSize) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <radialGradient id="glow" cx="50%" cy="50%" r="70%">
        <stop offset="0" stop-color="#1d1d20"/>
        <stop offset="1" stop-color="${background}"/>
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#glow)"/>
    ${mark(markSize, startX, startY)}
    <text x="${startX + markSize + gap}" y="${height / 2}" fill="#f5f5f7" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="700" dominant-baseline="central" letter-spacing="-${Math.max(1, Math.round(fontSize * 0.025))}">${escapeXml(buildBranding.name)}</text>
  </svg>`;
}

async function render(name: string, svg: string): Promise<void> {
  const png = new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng();
  await writeFile(join(output, name), png);
}

await mkdir(output, { recursive: true });
await Promise.all([
  render("launcher-icon.png", launcher(512)),
  render("android-tv-banner.png", tvTile(320, 180)),
  render("tvos-icon-small.png", tvTile(400, 240)),
  render("tvos-icon-small@2x.png", tvTile(800, 480)),
  render("tvos-icon-large.png", tvTile(1280, 768)),
  render("tvos-top-shelf.png", topShelf(1920, 720)),
  render("tvos-top-shelf@2x.png", topShelf(3840, 1440)),
  render("tvos-top-shelf-wide.png", topShelf(2320, 720)),
  render("tvos-top-shelf-wide@2x.png", topShelf(4640, 1440)),
]);
