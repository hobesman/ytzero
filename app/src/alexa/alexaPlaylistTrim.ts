/**
 * An Echo plays an HLS playlist from its first segment, whatever offset it is
 * given, and reports that offset plus the time played as its position. So to
 * start part way in, the playlist itself starts at the segment holding that
 * place, and the offset sent is where that segment starts.
 */

interface Segment { start: number; lines: string[] }

/** Allows for rounding in the segment durations added up. */
const EPSILON_SECONDS = 0.01;

function parse(playlist: string): { header: string[]; segments: Segment[]; footer: string[] } {
  const header: string[] = [];
  const segments: Segment[] = [];
  const footer: string[] = [];
  let time = 0;
  let current: { duration: number; lines: string[] } | null = null;
  for (const line of playlist.split("\n")) {
    if (line.startsWith("#EXTINF:")) {
      current = { duration: Number.parseFloat(line.slice("#EXTINF:".length)) || 0, lines: [line] };
      continue;
    }
    if (current) {
      current.lines.push(line);
      // A segment ends with its URI, the first line that isn't a tag.
      if (line && !line.startsWith("#")) {
        segments.push({ start: time, lines: current.lines });
        time += current.duration;
        current = null;
      }
      continue;
    }
    (segments.length ? footer : header).push(line);
  }
  return { header, segments, footer };
}

/** Index of the segment holding `offsetSeconds` (the last one, past the end). */
function holding(segments: Segment[], offsetSeconds: number): number {
  let index = 0;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].start <= offsetSeconds + EPSILON_SECONDS) index = i;
  }
  return index;
}

/** Where the segment holding `offsetSeconds` starts, in seconds (0 for a playlist with no segments). */
export function playlistSegmentStart(playlist: string, offsetSeconds: number): number {
  const { segments } = parse(playlist);
  return segments.length ? segments[holding(segments, offsetSeconds)].start : 0;
}

/** The playlist from the segment holding `offsetSeconds` on. */
export function trimPlaylist(playlist: string, offsetSeconds: number): string {
  if (!(offsetSeconds > 0)) return playlist;
  const { header, segments, footer } = parse(playlist);
  if (!segments.length) return playlist;
  const kept = segments.slice(holding(segments, offsetSeconds));
  return [...header, ...kept.flatMap((segment) => segment.lines), ...footer].join("\n");
}
