import { describe, expect, test } from "bun:test";
import { withSongKey } from "./musicCatalog";
import { createMusicTrackAlbum } from "./musicTrackAlbum";
import type { MusicTrack } from "./youtubeMusicParsers";

const track = (overrides: Partial<MusicTrack>): MusicTrack => ({
  videoId: "vid00000001", title: "Song", artist: "Band", artistId: null, album: null, duration: 200, thumbnail: "", isTopic: false, ...overrides,
});

describe("the album a song is on", () => {
  test("is the one the song's own radio entry links", async () => {
    const albumOf = createMusicTrackAlbum({
      radio: async () => [track({ albumId: "MPREb_own" }), track({ videoId: "next0000001", albumId: "MPREb_next" })],
      search: async () => { throw new Error("searched"); },
    });
    expect(await albumOf(1, withSongKey(track({})))).toBe("MPREb_own");
  });

  test("for a music video, is the album track's of the same song, and is kept", async () => {
    let searches = 0;
    const albumOf = createMusicTrackAlbum({
      radio: async () => [track({})],
      search: async () => {
        searches += 1;
        return [track({ videoId: "other000001", title: "Other", isTopic: true, albumId: "MPREb_wrong" }), track({ videoId: "atv00000001", isTopic: true, albumId: "MPREb_album" })];
      },
    });
    const video = withSongKey(track({ title: "Band - Song (Official Video)" }));
    expect(await albumOf(1, video)).toBe("MPREb_album");
    expect(await albumOf(1, video)).toBe("MPREb_album");
    expect(searches).toBe(1);
  });

  test("is null when nothing links one, and when YouTube Music fails", async () => {
    const none = createMusicTrackAlbum({ radio: async () => [], search: async () => [] });
    expect(await none(1, withSongKey(track({})))).toBe(null);
    const failing = createMusicTrackAlbum({ radio: async () => { throw new Error("down"); }, search: async () => { throw new Error("down"); } });
    expect(await failing(1, withSongKey(track({})))).toBe(null);
  });
});
