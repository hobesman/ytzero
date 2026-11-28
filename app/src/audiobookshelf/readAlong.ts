import { zipEntries, zipEntryBytes, zipEntryStart, type ReadRange, type ZipEntry } from "./epubZip";
import { mp4Duration } from "./mp4Duration";

/**
 * A read-aloud EPUB's sentences, each at its time in the audiobook: the text
 * the room tablet shows in lyrics mode while a book plays.
 *
 * Storyteller's read-aloud EPUBs (EPUB 3 Media Overlays) time every sentence
 * in their own copy of the narration, which is the audiobook's audio cut into
 * chunks: "00002-00005.mp4" is the fifth chunk of the book's second file.
 * Each chunk's length comes from its MP4 header; the chunks of one file of
 * the audiobook, laid end to end, are scaled onto that file's place in the
 * book. Without that naming, the whole narration is scaled onto the whole
 * book, as NanoHive's read-along reader does.
 */

export interface ReadAlongLine {
  /** Seconds into the audiobook. */
  time: number;
  text: string;
}

/** The parts of a book the timing needs: its length, and its audio files in play order. */
export interface ReadAlongBook {
  duration: number;
  tracks: { startOffset: number; duration: number }[];
}

interface Clip { textHref: string; textId: string; audio: string; begin: number; end: number }

const attributes = (tag: string): Record<string, string> => {
  const found: Record<string, string> = {};
  for (const match of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) found[match[1]] = match[3] ?? match[4] ?? "";
  return found;
};

const tags = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>`, "g"))].map((match) => match[0]);

/** A path inside the ZIP, relative to the file it appears in; keeps a #fragment. */
export function resolveHref(href: string, base: string): string {
  try {
    const url = new URL(href, `https://zip/${base.split("/").map(encodeURIComponent).join("/")}`);
    return decodeURIComponent(url.pathname.slice(1)) + (url.hash ? decodeURIComponent(url.hash) : "");
  } catch {
    return href;
  }
}

/** SMIL clock values: "12.5s", "1.2min", "500ms", "01:02:03.4". */
export function parseClock(value: string | undefined): number {
  const clock = (value ?? "").trim();
  if (!clock) return 0;
  const unit = /^(\d+(?:\.\d+)?)\s*(h|min|s|ms)?$/.exec(clock);
  if (unit) {
    const amount = Number(unit[1]);
    return unit[2] === "h" ? amount * 3600 : unit[2] === "min" ? amount * 60 : unit[2] === "ms" ? amount / 1000 : amount;
  }
  return clock.split(":").map(Number).reduce((total, part) => total * 60 + (Number.isFinite(part) ? part : 0), 0);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
const decode = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
  if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
  const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
  return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
});

/** The text of each element whose id is asked for, tags removed and spaces collapsed. */
export function textsById(xhtml: string, ids: Set<string>): Map<string, string> {
  const found = new Map<string, string>();
  const open: { name: string; id: string | null; from: number }[] = [];
  const body = xhtml.replace(/<!--[\s\S]*?-->/g, (comment) => " ".repeat(comment.length));
  for (const match of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>/g)) {
    const [whole, closing, name, rest, selfClosing] = match;
    if (closing) {
      const at = open.findLastIndex((element) => element.name === name);
      if (at < 0) continue;
      for (const element of open.splice(at)) {
        if (element.id && element.name === name) {
          found.set(element.id, decode(body.slice(element.from, match.index).replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim());
        }
      }
      continue;
    }
    if (selfClosing) continue;
    const id = attributes(rest).id;
    open.push({ name, id: id && ids.has(id) ? id : null, from: match.index! + whole.length });
  }
  return found;
}

async function mapLimit<T, R>(list: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) { const index = next++; results[index] = await work(list[index]); }
  }));
  return results;
}

/** The narration's files laid end to end, then placed on the audiobook. */
export function bookTimes(
  files: { name: string; duration: number | null; lastClipEnd: number }[], declaredTotal: number, book: ReadAlongBook,
): (file: number, at: number) => number {
  const unknown = files.filter((file) => file.duration == null);
  const known = files.reduce((sum, file) => sum + (file.duration ?? 0), 0);
  const estimated = unknown.reduce((sum, file) => sum + file.lastClipEnd, 0);
  const slack = declaredTotal > 0 && unknown.length ? Math.max(0, (declaredTotal - known - estimated) / unknown.length) : 0;
  const lengths = files.map((file) => file.duration ?? file.lastClipEnd + slack);
  const offsets: number[] = [];
  lengths.reduce((at, length, index) => { offsets[index] = at; return at + length; }, 0);
  const total = lengths.reduce((sum, length) => sum + length, 0);

  // "00002-00005.mp4": chunk 5 of the book's file 2. Anchor each file's chunks on that file, if every chunk says so.
  const groups = files.map((file) => /(\d+)-\d+\.[a-z0-9]+$/i.exec(file.name)?.[1]);
  const order = [...new Set(groups)];
  const anchored = groups.every(Boolean) && order.length === book.tracks.length && order.length > 1
    && order.every((group, index) => index === 0 || Number(group) > Number(order[index - 1]));
  if (anchored) {
    const groupStart = new Map<string, number>();
    const groupLength = new Map<string, number>();
    files.forEach((_, index) => {
      const group = groups[index]!;
      if (!groupStart.has(group)) groupStart.set(group, offsets[index]);
      groupLength.set(group, (groupLength.get(group) ?? 0) + lengths[index]);
    });
    return (file, at) => {
      const group = groups[file]!;
      const track = book.tracks[order.indexOf(group)];
      const length = groupLength.get(group)!;
      const within = offsets[file] - groupStart.get(group)! + at;
      return track.startOffset + (length > 0 ? within * track.duration / length : within);
    };
  }
  return (file, at) => total > 0 && book.duration > 0 ? (offsets[file] + at) * book.duration / total : offsets[file] + at;
}

/** The book's sentences in reading order, timed in the audiobook. */
export async function readAlongLines(read: ReadRange, size: number, book: ReadAlongBook): Promise<ReadAlongLine[]> {
  const entries = await zipEntries(read, size);
  const text = async (name: string) => {
    const entry = entries.get(name);
    return entry ? (await zipEntryBytes(read, entry)).toString("utf8") : null;
  };
  const container = await text("META-INF/container.xml");
  const opfPath = container && tags(container, "rootfile").map((tag) => attributes(tag)["full-path"]).find(Boolean);
  const opf = opfPath ? await text(opfPath) : null;
  if (!opfPath || !opf) throw new Error("the EPUB has no package document");

  const manifest = new Map<string, Record<string, string>>();
  for (const tag of tags(opf, "item")) {
    const item = attributes(tag);
    if (item.id && item.href) manifest.set(item.id, { ...item, path: resolveHref(item.href, opfPath) });
  }
  const declared = /<meta\b(?![^>]*\brefines=)[^>]*\bproperty="media:duration"[^>]*>([^<]+)</.exec(opf);
  const overlays = tags(opf, "itemref").map((tag) => manifest.get(attributes(tag).idref ?? ""))
    .map((item) => item?.["media-overlay"] ? manifest.get(item["media-overlay"])?.path : undefined)
    .filter((path): path is string => Boolean(path));

  const perOverlay = await mapLimit([...new Set(overlays)], 6, async (path): Promise<Clip[]> => {
    const smil = await text(path);
    if (!smil) return [];
    const clips: Clip[] = [];
    for (const par of smil.matchAll(/<(?:[\w-]+:)?par\b[\s\S]*?<\/(?:[\w-]+:)?par>/g)) {
      const textTag = tags(par[0], "text")[0];
      const audioTag = tags(par[0], "audio")[0];
      const source = textTag && attributes(textTag).src;
      const audio = audioTag ? attributes(audioTag) : null;
      if (!source || !audio?.src) continue;
      const [textHref, textId = ""] = resolveHref(source, path).split("#");
      const begin = parseClock(audio.clipBegin);
      clips.push({ textHref, textId, audio: resolveHref(audio.src, path), begin, end: Math.max(begin, parseClock(audio.clipEnd)) });
    }
    return clips;
  });
  const clips = perOverlay.flat();
  if (!clips.length) return [];

  const wanted = new Map<string, Set<string>>();
  for (const clip of clips) {
    if (!wanted.has(clip.textHref)) wanted.set(clip.textHref, new Set());
    wanted.get(clip.textHref)!.add(clip.textId);
  }
  const documents = new Map<string, Map<string, string>>();
  await mapLimit([...wanted], 6, async ([href, ids]) => {
    const xhtml = await text(href);
    documents.set(href, xhtml ? textsById(xhtml, ids) : new Map());
  });

  const audioFiles: string[] = [];
  const lastClipEnd = new Map<string, number>();
  for (const clip of clips) {
    if (!lastClipEnd.has(clip.audio)) audioFiles.push(clip.audio);
    lastClipEnd.set(clip.audio, Math.max(lastClipEnd.get(clip.audio) ?? 0, clip.end));
  }
  const durations = await mapLimit(audioFiles, 6, async (name) => {
    const entry: ZipEntry | undefined = entries.get(name);
    if (!entry || entry.method !== 0 || !/\.(mp4|m4a|m4b)$/i.test(name)) return null;
    return mp4Duration(read, await zipEntryStart(read, entry), entry.compressedSize).catch(() => null);
  });
  const at = bookTimes(audioFiles.map((name, index) => ({ name, duration: durations[index], lastClipEnd: lastClipEnd.get(name) ?? 0 })),
    parseClock(declared?.[1]), book);
  const fileIndex = new Map(audioFiles.map((name, index) => [name, index]));

  const lines: ReadAlongLine[] = [];
  for (const clip of clips) {
    const line = documents.get(clip.textHref)?.get(clip.textId);
    if (line) lines.push({ time: Math.round(at(fileIndex.get(clip.audio)!, clip.begin) * 100) / 100, text: line });
  }
  return lines.sort((a, b) => a.time - b.time);
}
