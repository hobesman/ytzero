/**
 * Matching what Alexa heard against names and titles. Speech recognition
 * mangles unusual words and drops punctuation, and people say part of a
 * title, so matching is forgiving: letter pairs for near-misses, and word
 * overlap for a partial title.
 */

/** Below these, a match is more likely wrong than right. */
export const CHANNEL_MATCH_MIN = 0.6;
export const TITLE_MATCH_MIN = 0.45;

const SMALL_WORDS = new Set(["a", "an", "the", "of", "and", "to", "in", "on", "for", "with", "is", "my", "how"]);

export function normalizeSpoken(text: string): string {
  return text
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function letterPairs(text: string): Map<string, number> {
  const compact = text.replace(/ /g, "");
  const pairs = new Map<string, number>();
  for (let index = 0; index + 1 < compact.length; index += 1) {
    const pair = compact.slice(index, index + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  return pairs;
}

/** Sørensen–Dice over letter pairs, ignoring spaces: 1 for the same letters. */
export function letterSimilarity(a: string, b: string): number {
  const left = letterPairs(normalizeSpoken(a));
  const right = letterPairs(normalizeSpoken(b));
  let total = 0;
  let shared = 0;
  for (const count of left.values()) total += count;
  for (const [pair, count] of right) {
    total += count;
    shared += Math.min(count, left.get(pair) ?? 0);
  }
  return total ? (2 * shared) / total : 0;
}

/** How much of what was said appears in the candidate, by meaningful words. */
export function wordCoverage(spoken: string, candidate: string): number {
  const said = normalizeSpoken(spoken).split(" ").filter((word) => word && !SMALL_WORDS.has(word));
  if (!said.length) return 0;
  const words = normalizeSpoken(candidate).split(" ");
  const found = said.filter((word) => words.some((other) => other === word || (word.length > 3 && letterSimilarity(word, other) >= 0.8)));
  return found.length / said.length;
}

/** A channel name is said whole, so near-misses matter most. */
export function channelScore(spoken: string, name: string): number {
  return Math.max(letterSimilarity(spoken, name), Math.min(wordCoverage(spoken, name), wordCoverage(name, spoken)));
}

/** A title is often said in part, so how much of what was said it covers matters most. */
export function titleScore(spoken: string, title: string): number {
  return Math.max(wordCoverage(spoken, title), letterSimilarity(spoken, title));
}

export function bestMatch<T>(spoken: string, candidates: readonly T[], text: (candidate: T) => string, score: (spoken: string, text: string) => number, minimum: number): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const item of candidates) {
    const value = score(spoken, text(item));
    // Earlier candidates win ties, so callers list the preferred (e.g. newest) first.
    if (value >= minimum && (!best || value > best.score)) best = { item, score: value };
  }
  return best;
}

/** Every way to read "<title> from <channel>", the last "from" first. */
export function fromSplits(query: string): { title: string; channel: string }[] {
  const words = query.trim().split(/\s+/);
  const splits: { title: string; channel: string }[] = [];
  for (let index = words.length - 2; index >= 1; index -= 1) {
    if (words[index].toLowerCase() !== "from") continue;
    splits.push({ title: words.slice(0, index).join(" "), channel: words.slice(index + 1).join(" ") });
  }
  return splits;
}

/** "12:34" or "1:02:03" in seconds, or null. */
export function durationSeconds(text: string | null | undefined): number | null {
  if (!text || !/^\d+(?::\d{1,2}){0,2}$/.test(text.trim())) return null;
  return text.trim().split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

/** An Alexa AMAZON.DURATION value such as "PT30S" or "PT1M30S" in seconds, or null. */
export function isoDurationSeconds(value: string | undefined): number | null {
  const match = value?.match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  return Math.round(Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0));
}
