/** What the top-bar search looks for: YouTube videos and channels, or YouTube Music. */
export type SearchMode = "videos" | "music";

/** The mode a page implies: music pages search music, everything else searches videos. */
export function searchModeForPath(pathname: string): SearchMode {
  return pathname === "/music" || pathname.startsWith("/music/") ? "music" : "videos";
}

/** Where a search for `query` in `mode` lands. An empty video search goes home, as it always has. */
export function searchPath(mode: SearchMode, query: string): string {
  const q = query.trim();
  if (mode === "music") return q ? `/music/search?q=${encodeURIComponent(q)}` : "/music/search";
  return q ? `/search?q=${encodeURIComponent(q)}` : "/";
}
