import { inflateRawSync } from "node:zlib";

/**
 * Reads single files out of a ZIP (an EPUB) that lives elsewhere, through
 * byte-range reads: the central directory at the end, then each file asked
 * for. A read-aloud EPUB is hundreds of megabytes of audio, of which the text
 * and timings are a few; none of the audio is downloaded.
 */

/** Bytes `start` to `end` inclusive. */
export type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflated. */
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_COMMENT = 0xffff;
/** No text file of a book is near this; it bounds what one entry may inflate to. */
export const MAX_ENTRY_BYTES = 16 * 1024 * 1024;

const view = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function lastSignature(buffer: Buffer, signature: number): number {
  for (let at = buffer.length - 4; at >= 0; at -= 1) if (buffer.readUInt32LE(at) === signature) return at;
  return -1;
}

/** The ZIP64 extra field's sizes and offset, for the values the plain fields mark as too big. */
function zip64Values(extra: Buffer, want: { size: boolean; compressed: boolean; offset: boolean }) {
  for (let at = 0; at + 4 <= extra.length;) {
    const id = extra.readUInt16LE(at);
    const length = extra.readUInt16LE(at + 2);
    if (id === 0x0001) {
      let field = at + 4;
      const next = () => { const value = Number(extra.readBigUInt64LE(field)); field += 8; return value; };
      return { size: want.size ? next() : null, compressed: want.compressed ? next() : null, offset: want.offset ? next() : null };
    }
    at += 4 + length;
  }
  return { size: null, compressed: null, offset: null };
}

/** Every file in the ZIP by name. */
export async function zipEntries(read: ReadRange, size: number): Promise<Map<string, ZipEntry>> {
  const tailStart = Math.max(0, size - (22 + MAX_COMMENT + 20 + 56));
  const tail = view(await read(tailStart, size - 1));
  const end = lastSignature(tail, EOCD);
  if (end < 0) throw new Error("not a ZIP file");
  let count = tail.readUInt16LE(end + 10);
  let directorySize = tail.readUInt32LE(end + 12);
  let directoryOffset = tail.readUInt32LE(end + 16);
  if (directoryOffset === 0xffffffff || count === 0xffff) {
    const end64 = lastSignature(tail.subarray(0, end), EOCD64);
    if (end64 < 0) throw new Error("ZIP64 directory missing");
    count = Number(tail.readBigUInt64LE(end64 + 32));
    directorySize = Number(tail.readBigUInt64LE(end64 + 40));
    directoryOffset = Number(tail.readBigUInt64LE(end64 + 48));
  }
  if (directoryOffset + directorySize > size || directorySize > 64 * 1024 * 1024) throw new Error("ZIP directory out of range");
  const directory = view(await read(directoryOffset, directoryOffset + directorySize - 1));
  const entries = new Map<string, ZipEntry>();
  let at = 0;
  for (let index = 0; index < count && at + 46 <= directory.length; index += 1) {
    if (directory.readUInt32LE(at) !== CENTRAL) throw new Error("ZIP directory is damaged");
    const nameLength = directory.readUInt16LE(at + 28);
    const extraLength = directory.readUInt16LE(at + 30);
    const commentLength = directory.readUInt16LE(at + 32);
    let compressedSize = directory.readUInt32LE(at + 20);
    let entrySize = directory.readUInt32LE(at + 24);
    let localOffset = directory.readUInt32LE(at + 42);
    const name = directory.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    if (compressedSize === 0xffffffff || entrySize === 0xffffffff || localOffset === 0xffffffff) {
      const extra = directory.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
      const big = zip64Values(extra, { size: entrySize === 0xffffffff, compressed: compressedSize === 0xffffffff, offset: localOffset === 0xffffffff });
      entrySize = big.size ?? entrySize;
      compressedSize = big.compressed ?? compressedSize;
      localOffset = big.offset ?? localOffset;
    }
    entries.set(name, { name, method: directory.readUInt16LE(at + 10), compressedSize, size: entrySize, localOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Where an entry's own bytes start: after its local header, whose extra field can differ from the directory's. */
export async function zipEntryStart(read: ReadRange, entry: ZipEntry): Promise<number> {
  const header = view(await read(entry.localOffset, entry.localOffset + 29));
  if (header.readUInt32LE(0) !== LOCAL) throw new Error(`ZIP entry ${entry.name} is damaged`);
  return entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
}

/** One entry's contents, inflated. */
export async function zipEntryBytes(read: ReadRange, entry: ZipEntry): Promise<Buffer> {
  if (entry.size > MAX_ENTRY_BYTES || entry.compressedSize > MAX_ENTRY_BYTES) throw new Error(`ZIP entry ${entry.name} is too large`);
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`ZIP entry ${entry.name} uses an unsupported compression`);
  // The local header and the data in one read, guessing the local extra field is short; a second read if not.
  const guess = 30 + Buffer.byteLength(entry.name) + 256;
  const first = view(await read(entry.localOffset, entry.localOffset + guess + entry.compressedSize - 1));
  if (first.readUInt32LE(0) !== LOCAL) throw new Error(`ZIP entry ${entry.name} is damaged`);
  const skip = 30 + first.readUInt16LE(26) + first.readUInt16LE(28);
  const data = skip + entry.compressedSize <= first.length
    ? first.subarray(skip, skip + entry.compressedSize)
    : view(await read(entry.localOffset + skip, entry.localOffset + skip + entry.compressedSize - 1));
  if (entry.method === 0) return Buffer.from(data);
  return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
}
