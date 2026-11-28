import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { parseBook, type Book } from "./audiobookshelfClient";
import { zipEntries, zipEntryBytes } from "./epubZip";
import { mp4Duration } from "./mp4Duration";
import { bookTimes, parseClock, readAlongLines, resolveHref, textsById } from "./readAlong";
import { createReadAlongCache } from "./readAlongCache";

/** A ZIP with the given files; `deflate` ones compressed, the rest stored (as an EPUB stores its audio). */
function zip(files: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = file.deflate ? deflateRawSync(file.data) : file.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(file.deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    // A local extra field the central directory doesn't have, as some writers leave.
    local.writeUInt16LE(4, 28);
    const extra = Buffer.from([0xfe, 0xca, 0, 0]);
    locals.push(local, name, extra, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(file.deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + extra.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const box = (type: string, body: Buffer) => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
};

/** An MP4 whose movie header says it lasts `seconds`, with its audio (mdat) before the header, as ffmpeg writes it. */
function mp4(seconds: number): Buffer {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(Math.round(seconds * 1000), 16);
  return Buffer.concat([box("ftyp", Buffer.from("M4A isom")), box("mdat", Buffer.alloc(5000, 7)), box("moov", box("mvhd", mvhd))]);
}

const reader = (bytes: Buffer) => {
  const reads: [number, number][] = [];
  const read = async (start: number, end: number) => {
    reads.push([start, end]);
    return bytes.subarray(start, Math.min(bytes.length - 1, end) + 1);
  };
  return { read, reads };
};

const par = (id: string, audio: string, begin: string, end: string) =>
  `<par id="p-${id}"><text src="../xhtml/ch1.xhtml#${id}"/><audio src="../Audio/${audio}" clipBegin="${begin}" clipEnd="${end}"/></par>`;

/** A two-file audiobook's read-aloud EPUB: chapter 1 read from both files' chunks. */
function readAloudEpub(): Buffer {
  const xhtml = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>
    <p><span id="s0"><b>CHAPTER ONE</b></span></p>
    <!-- <span id="s9">a comment, never read</span> -->
    <p><span id="s1">It was a dark &amp; stormy night.</span> <span id="s2">“Hello,” she said&#x2014;<i>quietly</i>.</span></p>
    <p><span id="s3">Second   file,
      second chunk.</span><span id="empty"></span></p>
  </body></html>`;
  const smil = `<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0"><body><seq id="ch1_overlay">
    ${par("s0", "00001-00001.mp4", "0s", "2.5s")}${par("s1", "00001-00002.mp4", "1s", "4s")}
    ${par("s2", "00002-00001.mp4", "0:00:02.000", "5s")}${par("s3", "00002-00002.mp4", "500ms", "1.5s")}${par("empty", "00002-00002.mp4", "2s", "3s")}
  </seq></body></smil>`;
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata>
    <meta property="media:duration" refines="#ch1_overlay">00:00:40.00</meta><meta property="media:duration">00:00:40.00</meta>
    </metadata><manifest>
    <item id="ch1" href="xhtml/ch1.xhtml" media-type="application/xhtml+xml" media-overlay="ch1_overlay"/>
    <item id="ch1_overlay" href="MediaOverlays/ch1.smil" media-type="application/smil+xml"/>
    <item id="cover" href="xhtml/cover.xhtml" media-type="application/xhtml+xml"/>
    </manifest><spine><itemref idref="cover"/><itemref idref="ch1"/></spine></package>`;
  return zip([
    { name: "mimetype", data: Buffer.from("application/epub+zip") },
    { name: "META-INF/container.xml", data: Buffer.from(`<container><rootfiles><rootfile full-path="OEBPS/package.opf"/></rootfiles></container>`), deflate: true },
    { name: "OEBPS/package.opf", data: Buffer.from(opf), deflate: true },
    { name: "OEBPS/MediaOverlays/ch1.smil", data: Buffer.from(smil), deflate: true },
    { name: "OEBPS/xhtml/ch1.xhtml", data: Buffer.from(xhtml), deflate: true },
    { name: "OEBPS/Audio/00001-00001.mp4", data: mp4(10) },
    { name: "OEBPS/Audio/00001-00002.mp4", data: mp4(10) },
    { name: "OEBPS/Audio/00002-00001.mp4", data: mp4(10) },
    { name: "OEBPS/Audio/00002-00002.mp4", data: mp4(10) },
  ]);
}

describe("read-along EPUBs", () => {
  test("read single files out of a ZIP, and an MP4's length from its header", async () => {
    const bytes = readAloudEpub();
    const { read, reads } = reader(bytes);
    const entries = await zipEntries(read, bytes.length);
    expect([...entries.keys()]).toContain("OEBPS/Audio/00002-00002.mp4");
    expect((await zipEntryBytes(read, entries.get("META-INF/container.xml")!)).toString()).toContain("OEBPS/package.opf");
    const movie = mp4(1234.5);
    expect(await mp4Duration(reader(movie).read, 0, movie.length)).toBe(1234.5);
    expect(await mp4Duration(reader(Buffer.alloc(64)).read, 0, 64)).toBeNull();
    // Only the end of a large file is read to find its directory.
    const large = Buffer.concat([Buffer.alloc(500_000), bytes]);
    const big = reader(large);
    const shifted = await zipEntries(async (start, end) => big.read(start, end), large.length).catch(() => null);
    expect(shifted).toBeNull(); // the offsets inside no longer match, but only the tail was asked for
    expect(big.reads[0][0]).toBeGreaterThan(400_000);
    expect(reads.length).toBeGreaterThan(0);
  });

  test("an MP4's header is found without reading its audio", async () => {
    const movie = mp4(42);
    const { read, reads } = reader(movie);
    expect(await mp4Duration(read, 0, movie.length)).toBe(42);
    expect(reads.every(([start, end]) => end - start < 4100)).toBe(true);
  });

  test("clocks, paths and sentence text", () => {
    expect(parseClock("1390.400s")).toBeCloseTo(1390.4);
    expect(parseClock("1.5min")).toBe(90);
    expect(parseClock("250ms")).toBe(0.25);
    expect(parseClock("01:02:03.5")).toBe(3723.5);
    expect(resolveHref("../xhtml/a%20b.xhtml#s1", "OEBPS/MediaOverlays/a.smil")).toBe("OEBPS/xhtml/a b.xhtml#s1");
    const texts = textsById(`<p><span id="a">One <span id="b">two</span> three</span><span id="c"/></p>`, new Set(["a", "b", "c"]));
    expect(texts.get("a")).toBe("One two three");
    expect(texts.get("b")).toBe("two");
    expect(texts.has("c")).toBe(false);
  });

  test("each file's chunks land on that file of the audiobook; otherwise the whole is scaled", () => {
    const files = [
      { name: "00001-00001.mp4", duration: 10, lastClipEnd: 9 }, { name: "00001-00002.mp4", duration: 10, lastClipEnd: 9 },
      { name: "00002-00001.mp4", duration: 20, lastClipEnd: 19 },
    ];
    // File 1 is 40 s in the audiobook (its chunks 20 s), file 2 is 20 s.
    const at = bookTimes(files, 0, { duration: 60, tracks: [{ startOffset: 0, duration: 40 }, { startOffset: 40, duration: 20 }] });
    expect(at(1, 5)).toBe(30);
    expect(at(2, 10)).toBe(50);
    const scaled = bookTimes(files, 0, { duration: 80, tracks: [{ startOffset: 0, duration: 80 }] });
    expect(scaled(2, 10)).toBe(60);
    // A file of unknown length lasts to its last sentence, plus a share of what the declared total leaves over.
    const guessed = bookTimes([{ name: "a.mp3", duration: null, lastClipEnd: 8 }, { name: "b.mp3", duration: null, lastClipEnd: 8 }], 20, { duration: 20, tracks: [] });
    expect(guessed(1, 0)).toBe(10);
  });

  test("a whole book's sentences, timed in the audiobook", async () => {
    const bytes = readAloudEpub();
    const book = { duration: 100, tracks: [{ startOffset: 0, duration: 60 }, { startOffset: 60, duration: 40 }] };
    expect(await readAlongLines(reader(bytes).read, bytes.length, book)).toEqual([
      { time: 0, text: "CHAPTER ONE" },
      { time: 33, text: "It was a dark & stormy night." },
      { time: 64, text: "“Hello,” she said—quietly." },
      { time: 81, text: "Second file, second chunk." },
    ]);
  });
});

const expanded = (files: { filename: string; ino: string; size?: number }[]) => ({
  id: "li_book", libraryId: "lib", mediaType: "book",
  media: { duration: 100, metadata: { title: "Book" }, tracks: [{ ino: "a1", duration: 60 }, { ino: "a2", duration: 40 }] },
  libraryFiles: files.map((file) => ({ ino: file.ino, metadata: { filename: file.filename, size: file.size ?? 10, mtimeMs: 5 } })),
});

describe("the read-along cache", () => {
  test("a read-aloud EPUB is recognised by its name", () => {
    expect(parseBook(expanded([{ filename: "Book.epub", ino: "e1" }, { filename: "Book (readaloud).epub", ino: "e2", size: 99 }]))?.readAloud)
      .toEqual({ ino: "e2", size: 99, modified: 5 });
    expect(parseBook(expanded([{ filename: "Book - Read Along.epub", ino: "e3" }]))?.readAloud?.ino).toBe("e3");
    expect(parseBook(expanded([{ filename: "Book.epub", ino: "e1" }, { filename: "readaloud.txt", ino: "t" }]))?.readAloud).toBeNull();
  });

  test("builds once, keeps the lines on disk, and reads a replaced EPUB again", async () => {
    const directory = mkdtempSync(join(tmpdir(), "readalong-"));
    try {
      let builds = 0;
      const build = async () => { builds += 1; return [{ time: builds, text: "Line" }]; };
      let book = parseBook(expanded([{ filename: "Book (readaloud).epub", ino: "e2" }]))!;
      const client = { book: async (id: string): Promise<Book | null> => (id === "li_book" ? book : null), fileRange: async () => new Uint8Array() };
      const cache = createReadAlongCache({ directory, build });
      expect(await cache.lines(client, "li_book")).toEqual([{ time: 1, text: "Line" }]);
      expect(await cache.lines(client, "li_book")).toEqual([{ time: 1, text: "Line" }]);
      expect(await createReadAlongCache({ directory, build }).lines(client, "li_book")).toEqual([{ time: 1, text: "Line" }]);
      expect(builds).toBe(1);
      book = { ...book, readAloud: { ...book.readAloud!, modified: 6 } };
      expect(await cache.lines(client, "li_book")).toEqual([{ time: 2, text: "Line" }]);
      expect(await cache.lines(client, "nope")).toBeNull();
      book = { ...book, readAloud: null };
      expect(await cache.lines(client, "li_book")).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a failure is remembered for a while, not retried on every request", async () => {
    const directory = mkdtempSync(join(tmpdir(), "readalong-"));
    try {
      let builds = 0;
      let clock = 0;
      const book = parseBook(expanded([{ filename: "Book (readaloud).epub", ino: "e2" }]))!;
      const client = { book: async () => book, fileRange: async () => new Uint8Array() };
      const cache = createReadAlongCache({ directory, now: () => clock, build: async () => { builds += 1; throw new Error("damaged"); } });
      await expect(cache.lines(client, "li_book")).rejects.toThrow("damaged");
      await expect(cache.lines(client, "li_book")).rejects.toThrow("damaged");
      expect(builds).toBe(1);
      clock += 11 * 60_000;
      await expect(cache.lines(client, "li_book")).rejects.toThrow("damaged");
      expect(builds).toBe(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
