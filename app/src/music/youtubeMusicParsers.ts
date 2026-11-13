// Pure parsers for YouTube Music responses. No network or database access.

/** One song as music mode knows it. Never stored in the video catalog. */
export interface MusicTrack {
  videoId: string;
  title: string;
  artist: string;
  artistId: string | null;
  album: string | null;
  /** Whole seconds, when YouTube reports it. */
  duration: number | null;
  thumbnail: string;
  /** An auto-generated "Topic" audio track rather than a music video. */
  isTopic: boolean;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function collect(node: unknown, key: string, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collect(item, key, out);
    return out;
  }
  const record = node as Record<string, unknown>;
  if (key in record) out.push(record[key]);
  for (const value of Object.values(record)) collect(value, key, out);
  return out;
}

export function parseDurationText(text: unknown): number | null {
  if (typeof text !== "string" || !/^\d+(?::\d{1,2}){1,2}$/.test(text.trim())) return null;
  return text.trim().split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

/** Pick the largest thumbnail and ask Google's image host for a square-ish 544px copy. */
export function largestThumbnail(thumbnails: unknown): string {
  if (!Array.isArray(thumbnails) || !thumbnails.length) return "";
  const best = [...thumbnails].sort((a, b) => (Number(b?.width) || 0) - (Number(a?.width) || 0))[0];
  const url = typeof best?.url === "string" ? best.url : "";
  return url.replace(/=w\d+-h\d+(-[a-z0-9-]+)?$/i, "=w544-h544-l90-rj");
}

function pageType(run: any): string | undefined {
  return run?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
    ?.browseEndpointContextMusicConfig?.pageType;
}

function videoType(endpoint: any): string | undefined {
  return endpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
}

/** Split a byline such as "Artist & Other • Album • 3:32" into its parts. */
export function parseByline(runs: any[]): { artist: string; artistId: string | null; album: string | null; duration: number | null } {
  const artists: string[] = [];
  let artistId: string | null = null;
  let album: string | null = null;
  let duration: number | null = null;
  let segment = 0;
  for (const run of runs) {
    const text = typeof run?.text === "string" ? run.text : "";
    if (text.trim() === "•") { segment++; continue; }
    const type = pageType(run);
    if (type === "MUSIC_PAGE_TYPE_ARTIST" || type === "MUSIC_PAGE_TYPE_USER_CHANNEL") {
      artists.push(text);
      artistId ??= run.navigationEndpoint.browseEndpoint.browseId ?? null;
    } else if (type === "MUSIC_PAGE_TYPE_ALBUM") {
      album = text;
    } else if (parseDurationText(text) !== null) {
      duration = parseDurationText(text);
    } else if (segment === 0 && text && !/^\s*[&,]\s*$/.test(text)) {
      // Artists without a channel link still appear as plain text in the first segment.
      artists.push(text);
    }
  }
  const artist = artists.join(", ").replace(/\s+-\s+Topic$/, "").trim();
  return { artist, artistId, album, duration };
}

export function parsePanelTrack(renderer: any): MusicTrack | null {
  const videoId = renderer?.videoId;
  if (typeof videoId !== "string" || !VIDEO_ID.test(videoId)) return null;
  const title = renderer?.title?.runs?.map((run: any) => run?.text ?? "").join("") ?? renderer?.title?.simpleText ?? "";
  const byline = parseByline(renderer?.longBylineText?.runs ?? renderer?.shortBylineText?.runs ?? []);
  const lengthText = renderer?.lengthText?.runs?.[0]?.text ?? renderer?.lengthText?.simpleText;
  return {
    videoId,
    title,
    artist: byline.artist,
    artistId: byline.artistId,
    album: byline.album,
    duration: parseDurationText(lengthText) ?? byline.duration,
    thumbnail: largestThumbnail(renderer?.thumbnail?.thumbnails),
    isTopic: videoType(renderer?.navigationEndpoint) === "MUSIC_VIDEO_TYPE_ATV",
  };
}

/** Tracks of a radio ("Mix") queue from a `next` response, in order and without repeats. */
export function parseRadioResponse(data: unknown): MusicTrack[] {
  const tracks: MusicTrack[] = [];
  const seen = new Set<string>();
  for (const panel of collect(data, "playlistPanelRenderer")) {
    for (const item of panel?.contents ?? []) {
      // A wrapper holds the song and its alternate (video or audio) version; keep the primary.
      const renderer = item?.playlistPanelVideoRenderer
        ?? item?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
      const track = parsePanelTrack(renderer);
      if (track && !seen.has(track.videoId)) {
        seen.add(track.videoId);
        tracks.push(track);
      }
    }
  }
  return tracks;
}

export function parseSearchItem(item: any): MusicTrack | null {
  const columns = (item?.flexColumns ?? []).map((column: any) => column?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []);
  const titleRun = columns[0]?.[0];
  const videoId = item?.playlistItemData?.videoId ?? titleRun?.navigationEndpoint?.watchEndpoint?.videoId;
  if (typeof videoId !== "string" || !VIDEO_ID.test(videoId)) return null;
  const byline = parseByline(columns[1] ?? []);
  const fixedDuration = item?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text;
  return {
    videoId,
    title: titleRun?.text ?? "",
    artist: byline.artist,
    artistId: byline.artistId,
    album: byline.album,
    duration: byline.duration ?? parseDurationText(fixedDuration),
    thumbnail: largestThumbnail(item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
    isTopic: videoType(titleRun?.navigationEndpoint) === "MUSIC_VIDEO_TYPE_ATV",
  };
}

export function parseSearchResponse(data: unknown): MusicTrack[] {
  const tracks: MusicTrack[] = [];
  const seen = new Set<string>();
  for (const item of collect(data, "musicResponsiveListItemRenderer")) {
    const track = parseSearchItem(item);
    if (track && !seen.has(track.videoId)) {
      seen.add(track.videoId);
      tracks.push(track);
    }
  }
  return tracks;
}
