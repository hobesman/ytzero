import { database } from "../database";
import { upsertMusicTracks, type StoredMusicTrack } from "./musicCatalog";
import { songKey } from "./musicSongKey";
import type { MusicTrack } from "./youtubeMusicParsers";

/**
 * A song's album cover for the Echo's screen and the room tablet. A song
 * from an album (YouTube's "Topic" audio track) already has its cover as its
 * picture, but a music video's picture is a frame of the video. For one of
 * those, the cover is the album track's of the same song (the same song key):
 * from the catalog when it has one, else from a YouTube Music song search,
 * which is then kept in the catalog. Never throws; the video's picture when
 * there is no album track or the search is slow.
 */
export interface MusicAlbumArtDependencies {
  /** The picture of a Topic track with this song key in the catalog, or null. */
  byKey?: (key: string) => Promise<string | null>;
  search: (userId: number, query: string) => Promise<MusicTrack[]>;
  save?: (tracks: MusicTrack[]) => Promise<unknown>;
  now?: () => number;
  waitMs?: number;
}

const COVER_TTL_MS = 24 * 60 * 60 * 1000;
const COVER_LIMIT = 1000;
/** How long a search may hold up a Play: Alexa wants its answer within a few seconds. */
export const ALBUM_ART_WAIT_MS = 1_500;

const catalogCover = async (key: string): Promise<string | null> =>
  (await database.prepare("SELECT thumbnail FROM music_tracks WHERE song_key = ? AND is_topic = 1 AND thumbnail <> '' ORDER BY updated_at DESC LIMIT 1")
    .get<{ thumbnail: string }>(key))?.thumbnail ?? null;

export function createMusicAlbumArt(dependencies: MusicAlbumArtDependencies) {
  const byKey = dependencies.byKey ?? catalogCover;
  const save = dependencies.save ?? upsertMusicTracks;
  const now = dependencies.now ?? Date.now;
  const waitMs = dependencies.waitMs ?? ALBUM_ART_WAIT_MS;
  // By video: the cover found, or "" when the song has no album track.
  const covers = new Map<string, { cover: string; at: number }>();
  const running = new Map<string, Promise<string>>();

  const remember = (videoId: string, cover: string) => {
    covers.delete(videoId);
    covers.set(videoId, { cover, at: now() });
    while (covers.size > COVER_LIMIT) covers.delete(covers.keys().next().value!);
  };

  async function find(userId: number, track: StoredMusicTrack): Promise<string> {
    const known = await byKey(track.songKey).catch(() => null);
    if (known) return known;
    const results = await dependencies.search(userId, `${track.artist} ${track.title}`).catch(() => [] as MusicTrack[]);
    const match = results.find((result) => result.isTopic && result.thumbnail && songKey(result.artist, result.title) === track.songKey);
    if (match) await save([match]).catch(() => {});
    return match?.thumbnail ?? "";
  }

  return async function cover(userId: number, track: StoredMusicTrack): Promise<string> {
    if (track.isTopic) return track.thumbnail;
    const hit = covers.get(track.videoId);
    if (hit && now() - hit.at < COVER_TTL_MS) return hit.cover || track.thumbnail;
    let task = running.get(track.videoId);
    if (!task) {
      task = find(userId, track).then((found) => { remember(track.videoId, found); return found; })
        .finally(() => running.delete(track.videoId));
      running.set(track.videoId, task);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const found = await Promise.race([task, new Promise<string>((resolve) => { timer = setTimeout(() => resolve(""), waitMs); })])
      .finally(() => clearTimeout(timer));
    return found || track.thumbnail;
  };
}

export type MusicAlbumArt = ReturnType<typeof createMusicAlbumArt>;
