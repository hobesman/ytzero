import type { ReadRange } from "./epubZip";

/**
 * An MP4's length in seconds, from its movie header (moov/mvhd), reading a few
 * box headers rather than the file: the audio data in between (mdat) is
 * stepped over. Null when there is no such header.
 */
export async function mp4Duration(read: ReadRange, start: number, length: number): Promise<number | null> {
  const end = start + length;
  let at = start;
  for (let hops = 0; hops < 32 && at + 8 <= end; hops += 1) {
    const header = Buffer.from(await read(at, Math.min(end, at + 16) - 1));
    if (header.length < 8) return null;
    let size = header.readUInt32BE(0);
    const type = header.toString("latin1", 4, 8);
    let headerLength = 8;
    if (size === 1) {
      if (header.length < 16) return null;
      size = Number(header.readBigUInt64BE(8));
      headerLength = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < headerLength) return null;
    if (type === "moov") return movieHeaderDuration(read, at + headerLength, Math.min(at + size, end));
    at += size;
  }
  return null;
}

async function movieHeaderDuration(read: ReadRange, start: number, end: number): Promise<number | null> {
  // mvhd comes first in every encoder's moov; it is 120 bytes at most.
  const bytes = Buffer.from(await read(start, Math.min(end, start + 4096) - 1));
  for (let at = 0; at + 8 <= bytes.length;) {
    const size = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    if (type === "mvhd") {
      const box = bytes.subarray(at + 8, at + size);
      const version = box[0];
      if (box.length < (version === 1 ? 32 : 20)) return null;
      const timescale = version === 1 ? box.readUInt32BE(20) : box.readUInt32BE(12);
      const duration = version === 1 ? Number(box.readBigUInt64BE(24)) : box.readUInt32BE(16);
      return timescale > 0 && duration > 0 && duration !== 0xffffffff ? duration / timescale : null;
    }
    if (size < 8) return null;
    at += size;
  }
  return null;
}
