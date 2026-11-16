import { describe, expect, test } from "bun:test";
import { artistOnlyTracks, artistSongPools } from "./musicArtistStation";
import type { MusicPages } from "./musicAlbums";
import type { StoredMusicTrack } from "./musicCatalog";
import { parseStationSeed, stationSeedKey } from "./musicStation";

const track = (n: number, songKey = `song-${n}`): StoredMusicTrack => ({
  videoId: `vid${String(n).padStart(8, "0")}`, title: `Song ${n}`, artist: "Band", artistId: "UCband", album: null,
  duration: 200, thumbnail: "", isTopic: true, songKey,
});
const noRatings = { ratings: new Map<string, number>() };
const fresh = { served: [], servedIds: [], skipped: new Set<string>() };
const inOrder = () => 0.999;

describe("artist-only plays", () => {
  test("keeps top songs ahead of album songs", () => {
    const top = [track(1), track(2)];
    const album = [track(3), track(4)];
    const picked = artistOnlyTracks([top, album], noRatings, fresh, inOrder).map((entry) => entry.videoId);
    expect(picked.slice(0, 2).sort()).toEqual([track(1).videoId, track(2).videoId]);
    expect(picked.slice(2).sort()).toEqual([track(3).videoId, track(4).videoId]);
  });

  test("plays the same artist back to back, with no cooldown", () => {
    expect(artistOnlyTracks([[track(1), track(2), track(3), track(4)]], noRatings, fresh)).toHaveLength(4);
  });

  test("drops songs played, skipped, disliked, and other uploads of a song", () => {
    const played = track(1);
    const pool = [played, track(2), track(3), track(4), track(5, "song-1"), track(6, "song-6"), track(7, "song-6")];
    const picked = artistOnlyTracks(
      [pool],
      { ratings: new Map([[track(3).videoId, -1]]) },
      { served: [played], servedIds: [played.videoId], skipped: new Set([track(4).videoId]) },
    );
    const keys = picked.map((entry) => entry.songKey).sort();
    expect(keys).toEqual(["song-2", "song-6"]);
  });

  test("the first batch skips the album pages, later ones read them", async () => {
    const requested: string[] = [];
    const pages = {
      album: async (_userId: number, id: string) => { requested.push(id); return { tracks: [track(9)] }; },
    } as unknown as MusicPages;
    expect(await artistSongPools(pages, 1, [track(1)], ["MPREb_a", "MPREb_b"], true)).toEqual([[track(1)]]);
    expect(requested).toEqual([]);
    const later = await artistSongPools(pages, 1, [track(1)], ["MPREb_a", "MPREb_b"], false);
    expect(requested).toEqual(["MPREb_a", "MPREb_b"]);
    expect(later[1]).toHaveLength(2);
  });

  test("an album page that fails doesn't stop the play", async () => {
    const pages = { album: async () => { throw new Error("down"); } } as unknown as MusicPages;
    expect(await artistSongPools(pages, 1, [track(1)], ["MPREb_a"], false)).toEqual([[track(1)], []]);
  });
});

describe("artist seeds", () => {
  test("keep the radio flag apart from an artist-only play", () => {
    const artistId = "UCabcdefghijklmnopqrstuv";
    const only = parseStationSeed({ kind: "artist", artistId });
    const radio = parseStationSeed({ kind: "artist", artistId, radio: true });
    expect(only).toEqual({ kind: "artist", artistId });
    expect(radio).toEqual({ kind: "artist", artistId, radio: true });
    expect(parseStationSeed({ kind: "artist", artistId, radio: "yes" })).toEqual({ kind: "artist", artistId });
    expect(stationSeedKey(only!)).not.toBe(stationSeedKey(radio!));
  });
});
