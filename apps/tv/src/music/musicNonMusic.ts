import { fetchSponsorSegments } from "../sponsorBlock";
import type { MusicTrack } from "./musicApi";

const CATEGORY = "music_offtopic";
const CACHE_LIMIT = 300;
const cache = new Map<string, Promise<[number, number][]>>();

/**
 * The non-music parts (talking intros, skits, outros) of a music video, from
 * SponsorBlock's public list. Topic uploads are album audio and have none.
 * Nothing is reported anywhere: music mode keeps no skip log.
 */
export function nonMusicSegments(track: Pick<MusicTrack, "videoId" | "isTopic">): Promise<[number, number][]> {
  if (track.isTopic) return Promise.resolve([]);
  let segments = cache.get(track.videoId);
  if (!segments) {
    segments = fetchSponsorSegments(track.videoId, [CATEGORY])
      .then((found) => found.filter((item) => item.category === CATEGORY).map((item) => item.segment))
      .catch(() => {
        cache.delete(track.videoId);
        return [];
      });
    cache.set(track.videoId, segments);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  }
  return segments;
}
