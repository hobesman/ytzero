/** The synced line being sung at `position` seconds: the last one already started, or -1 before the first. */
export function currentLyricIndex(lines: readonly { time: number }[], position: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (lines[middle]!.time <= position) { found = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return found;
}
