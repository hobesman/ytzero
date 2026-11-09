/** SponsorBlock segments, fetched from the public SponsorBlock API like the web player does. */
export type SponsorSegment = { category: string; actionType: string; segment: [number, number]; UUID: string };

/** The profile's SponsorBlock choice, from its server settings. Null when skipping is off. */
export function sponsorCategories(enabled: unknown, categories: unknown): string[] | null {
  if (enabled !== "1") return null;
  try {
    const parsed: unknown = JSON.parse(typeof categories === "string" && categories ? categories : '["sponsor"]');
    const list = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 50) : [];
    return list.length ? list : null;
  } catch { return ["sponsor"]; }
}

/** Only well-formed "skip" segments, each with a stable id. */
export function normalizeSponsorSegments(videoId: string, segments: unknown): SponsorSegment[] {
  if (!Array.isArray(segments)) return [];
  return segments.flatMap((item, index) => {
    const segment = item as Partial<SponsorSegment> & { uuid?: string };
    const start = Number(segment.segment?.[0]);
    const end = Number(segment.segment?.[1]);
    if (segment.actionType !== "skip" || typeof segment.category !== "string" || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return [{ category: segment.category, actionType: "skip", segment: [start, end] as [number, number],
      UUID: segment.UUID || segment.uuid || `${videoId}:${segment.category}:${start}:${end}:${index}` }];
  });
}

export async function fetchSponsorSegments(videoId: string, categories: string[], signal?: AbortSignal): Promise<SponsorSegment[]> {
  const query = `videoID=${encodeURIComponent(videoId)}&categories=${encodeURIComponent(JSON.stringify(categories))}`;
  const response = await fetch(`https://sponsor.ajay.app/api/skipSegments?${query}`, { signal });
  // 404 means the video has no segments.
  if (!response.ok) return [];
  return normalizeSponsorSegments(videoId, await response.json().catch(() => []));
}

/**
 * The segment the position is inside, if any. Near its end (within `margin`)
 * there is nothing left worth skipping, as in the web player.
 */
export function segmentAt(segments: SponsorSegment[], position: number, margin = 0.3): SponsorSegment | null {
  return segments.find((item) => position >= item.segment[0] && position < item.segment[1] - margin) ?? null;
}
