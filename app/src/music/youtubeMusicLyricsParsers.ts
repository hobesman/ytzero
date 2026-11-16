/** YouTube Music's lyrics: the "Lyrics" tab of a song's watch page, and the page that tab opens. */

export interface YouTubeMusicLyrics {
  text: string;
  /** Who YouTube Music credits, e.g. "Source: Musixmatch". */
  source: string | null;
}

const LYRICS_BROWSE_ID = /^MPLY[A-Za-z0-9_-]{4,120}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function path(value: unknown, ...keys: (string | number)[]): unknown {
  let at = value;
  for (const key of keys) {
    if (typeof key === "number") at = Array.isArray(at) ? at[key] : undefined;
    else at = record(at)?.[key];
  }
  return at;
}

function runsText(value: unknown): string {
  const runs = path(value, "runs");
  return Array.isArray(runs) ? runs.map((run) => typeof record(run)?.text === "string" ? record(run)!.text as string : "").join("") : "";
}

/**
 * The browse ID of the song's lyrics page, from a `next` response. Null when
 * YouTube Music has no lyrics for it: the tab is then marked unselectable.
 */
export function lyricsBrowseId(next: unknown): string | null {
  const tabs = path(next, "contents", "singleColumnMusicWatchNextResultsRenderer", "tabbedRenderer", "watchNextTabbedResultsRenderer", "tabs");
  if (!Array.isArray(tabs)) return null;
  for (const tab of tabs) {
    const renderer = record(path(tab, "tabRenderer"));
    if (!renderer || renderer.unselectable === true) continue;
    const browse = record(path(renderer, "endpoint", "browseEndpoint"));
    const pageType = path(browse, "browseEndpointContextSupportedConfigs", "browseEndpointContextMusicConfig", "pageType");
    const browseId = browse?.browseId;
    if (typeof browseId !== "string" || !LYRICS_BROWSE_ID.test(browseId)) continue;
    if (pageType === undefined || pageType === "MUSIC_PAGE_TYPE_TRACK_LYRICS") return browseId;
  }
  return null;
}

/** The lyrics on a lyrics page, or null when the page has none. */
export function parseLyricsPage(browse: unknown): YouTubeMusicLyrics | null {
  const sections = path(browse, "contents", "sectionListRenderer", "contents");
  if (!Array.isArray(sections)) return null;
  for (const section of sections) {
    const shelf = path(section, "musicDescriptionShelfRenderer");
    if (!shelf) continue;
    const text = runsText(path(shelf, "description")).replace(/\r\n?/g, "\n").trim();
    if (!text) continue;
    const source = runsText(path(shelf, "footer")).trim();
    return { text: text.slice(0, 20_000), source: source || null };
  }
  return null;
}
