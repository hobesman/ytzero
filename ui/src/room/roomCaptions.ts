import type { VideoSubtitle } from "../apiTypes";

/** A caption line and when it starts, in seconds: the shape synced lyrics have, so the lyrics view shows either. */
export type CaptionLine = { time: number; text: string };

const CUE_TIMING = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})\s+-->/;

function seconds(match: RegExpMatchArray): number {
  return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function plainText(line: string): string {
  return line.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, "\"").replace(/\s+/g, " ").trim();
}

/**
 * A WebVTT file's lines, each with the time it first shows. YouTube's
 * automatic captions roll: every cue repeats the line before it, and brief
 * cues repeat both; each line is kept once, at its first appearance.
 */
export function captionLines(vtt: string): CaptionLine[] {
  const lines: CaptionLine[] = [];
  const recent: string[] = [];
  for (const block of vtt.replace(/\r/g, "").split(/\n{2,}/)) {
    const rows = block.split("\n");
    const at = rows.findIndex((row) => CUE_TIMING.test(row.trim()));
    if (at < 0) continue;
    const time = seconds(rows[at].trim().match(CUE_TIMING)!);
    for (const row of rows.slice(at + 1)) {
      const text = plainText(row);
      if (!text || recent.includes(text)) continue;
      lines.push({ time, text });
      recent.push(text);
      if (recent.length > 3) recent.shift();
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** The subtitle track in the page's language, else English, else whatever there is. */
export function pickCaptions(subtitles: VideoSubtitle[], locale: string): VideoSubtitle | null {
  const base = (code: string) => code.toLowerCase().split(/[-_]/)[0];
  const wanted = locale.toLowerCase();
  return subtitles.find((subtitle) => subtitle.lang.toLowerCase() === wanted)
    ?? subtitles.find((subtitle) => base(subtitle.lang) === base(wanted))
    ?? subtitles.find((subtitle) => base(subtitle.lang) === "en")
    ?? subtitles[0]
    ?? null;
}
