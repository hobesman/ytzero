import { describe, expect, test } from "bun:test";
import { createMusicAlbumArt } from "./musicAlbumArt";
import { withSongKey } from "./musicCatalog";
import type { MusicTrack } from "./youtubeMusicParsers";

const track = (overrides: Partial<MusicTrack>): MusicTrack => ({
  videoId: "vid00000001", title: "Song", artist: "Band", artistId: null, album: null, duration: 200,
  thumbnail: "https://i.ytimg.com/vi/vid00000001/hqdefault.jpg", isTopic: false, ...overrides,
});
const video = withSongKey(track({ title: "Band - Song (Official Video)" }));
const albumTrack = track({ videoId: "atv00000001", thumbnail: "https://lh3.googleusercontent.com/cover=w544-h544", isTopic: true });

describe("a song's album cover", () => {
  test("an album track keeps its own picture, asking nothing", async () => {
    const cover = createMusicAlbumArt({ byKey: async () => { throw new Error("asked"); }, search: async () => { throw new Error("asked"); } });
    const topic = withSongKey(albumTrack);
    expect(await cover(1, topic)).toBe(topic.thumbnail);
  });

  test("a music video takes the cover of the catalog's album track of the same song", async () => {
    const keys: string[] = [];
    const cover = createMusicAlbumArt({ byKey: async (key) => { keys.push(key); return "https://cover"; }, search: async () => [] });
    expect(await cover(1, video)).toBe("https://cover");
    expect(keys).toEqual([video.songKey]);
  });

  test("else searches YouTube Music, keeps the match in the catalog, and asks only once", async () => {
    let searches = 0;
    const saved: MusicTrack[] = [];
    const cover = createMusicAlbumArt({
      byKey: async () => null,
      search: async () => { searches += 1; return [track({ videoId: "other000001", title: "Another Song", isTopic: true, thumbnail: "https://wrong" }), albumTrack]; },
      save: async (tracks) => { saved.push(...tracks); },
    });
    expect(await cover(1, video)).toBe(albumTrack.thumbnail);
    expect(await cover(1, video)).toBe(albumTrack.thumbnail);
    expect(searches).toBe(1);
    expect(saved.map((item) => item.videoId)).toEqual([albumTrack.videoId]);
  });

  test("keeps the video's picture when there's no album track or the search is slow", async () => {
    const none = createMusicAlbumArt({ byKey: async () => null, search: async () => [track({ videoId: "x0000000001", isTopic: false })] });
    expect(await none(1, video)).toBe(video.thumbnail);
    const slow = createMusicAlbumArt({ byKey: async () => null, search: () => new Promise(() => {}), waitMs: 5 });
    expect(await slow(1, video)).toBe(video.thumbnail);
  });
});
