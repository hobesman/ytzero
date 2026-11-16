import { describe, expect, test } from "bun:test";
import type { PhoneDownloadsNative } from "../phoneDownloadsNative";
import { MusicApiError, type MusicAlbumPage, type MusicPlay, type MusicPlaylistPage, type MusicTrack, type MusicUserPlaylistPage } from "./musicApi";
import {
  MUSIC_DOWNLOAD_PIECE_BYTES, MusicDownloadStore, musicArtworkFile, musicAudioFile, musicCollectionProgress, musicDownloadBytes,
  musicDownloadedSingles, parseMusicDownloadIndex, type MusicDownloadConnection,
} from "./musicDownloads";
import { OfflineMusicApi, offlineStation } from "./musicOfflineApi";

const track = (id: string, patch: Partial<MusicTrack> = {}): MusicTrack => ({
  videoId: id, title: `Song ${id}`, artist: "Artist", artistId: "UCartist", album: "Album", duration: 200, thumbnail: `https://lh3/${id}.jpg`,
  isTopic: true, rating: null, ...patch,
});

/** Song sizes on the fake server; each fetchRange call sends at most one piece. */
function fakeNative(sizes: Map<string, number>) {
  const files = new Map<string, number>();
  const calls: { url: string; headers: Record<string, string>; name: string; start: number }[] = [];
  let network = true;
  let metered = false;
  let status = 206;
  const native: PhoneDownloadsNative = {
    directoryUri: () => "file:///data/downloads",
    enqueue: async () => "1", query: async () => [], finish: async () => -1, cancel: async () => true,
    fetchFile: async (_url, _headers, name) => { files.set(name, 10); return network ? 10 : -1; },
    fetchRange: async (url, headers, name, start, end) => {
      calls.push({ url, headers, name, start });
      if (!network) return { status: -1, size: start, total: -1 };
      if (status !== 206) return { status, size: start, total: -1 };
      const have = files.get(`${name}.part`) ?? 0;
      if (start !== 0 && have !== start) return { status: 416, size: have, total: -1 };
      const id = decodeURIComponent(url.split("/tracks/")[1]!.split("/")[0]!);
      const total = sizes.get(id) ?? 0;
      const size = Math.min(total, end + 1);
      files.set(`${name}.part`, size);
      return { status: 206, size, total };
    },
    completePart: async (name) => {
      const size = files.get(`${name}.part`);
      if (size === undefined) return -1;
      files.delete(`${name}.part`);
      files.set(name, size);
      return size;
    },
    isMetered: () => metered,
    readText: async (name) => files.has(name) ? (texts.get(name) ?? null) : null,
    writeText: async (name, text) => { files.set(name, text.length); texts.set(name, text); return true; },
    deleteFile: async (name) => { files.delete(name); files.delete(`${name}.part`); return true; },
    fileSize: async (name) => files.get(name) ?? -1,
    freeBytes: async () => 5e9,
  };
  const texts = new Map<string, string>();
  return {
    native, files, calls,
    setNetwork(value: boolean) { network = value; }, setMetered(value: boolean) { metered = value; }, setStatus(value: number) { status = value; },
  };
}

function fakeServer() {
  const albums = new Map<string, MusicAlbumPage>();
  const playlists = new Map<string, MusicPlaylistPage>();
  const mine = new Map<string, MusicUserPlaylistPage>();
  const plays: MusicPlay[] = [];
  let online = true;
  const reach = () => { if (!online) throw new TypeError("Network request failed"); };
  const api: MusicDownloadConnection["api"] = {
    album: async (id) => { reach(); const page = albums.get(id); if (!page) throw new MusicApiError("not found", 404); return page; },
    playlist: async (id) => { reach(); const page = playlists.get(id); if (!page) throw new MusicApiError("not found", 404); return page; },
    myPlaylist: async (id) => { reach(); const page = mine.get(id); if (!page) throw new MusicApiError("not found", 404); return page; },
    recordPlay: async (play) => { reach(); plays.push(play); return { ok: true }; },
    audioUrl: (id) => `https://yt.example/api/music/tracks/${encodeURIComponent(id)}/audio`,
    artworkSource: (url) => url ? { uri: `https://yt.example/api/img?u=${encodeURIComponent(url)}`, headers: { Authorization: "Bearer token" } } : null,
  };
  return { api, albums, playlists, mine, plays, setOnline(value: boolean) { online = value; } };
}

const timers = () => {
  let now = 1000;
  const pending: (() => void)[] = [];
  return {
    timers: { now: () => now++, setTimeout: (callback: () => void) => { pending.push(callback); return pending.length; }, clearTimeout: () => {} },
    fire() { const list = pending.splice(0); list.forEach((callback) => callback()); },
  };
};

const album = (id: string, tracks: MusicTrack[]): MusicAlbumPage => ({
  browseId: id, title: `Album ${id}`, artist: "Artist", artistId: "UCartist", year: "2024", thumbnail: `https://lh3/${id}-cover.jpg`, kind: "album", tracks, saved: true,
});

async function setup(sizes: [string, number][] = []) {
  const device = fakeNative(new Map(sizes));
  const server = fakeServer();
  const clock = timers();
  const store = new MusicDownloadStore(device.native, clock.timers);
  const owner = "https://yt.example#1";
  await store.connect({ owner, accessToken: "token", api: server.api });
  return { device, server, clock, store, owner };
}

const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); };

describe("music downloads", () => {
  test("fetches a song a piece at a time with the sign-in, then plays it from the file", async () => {
    const size = MUSIC_DOWNLOAD_PIECE_BYTES * 2 + 5;
    const { device, store, owner } = await setup([["a", size]]);
    await store.downloadTrack(track("a"));
    await flush();
    expect(device.calls.map((call) => call.start)).toEqual([0, MUSIC_DOWNLOAD_PIECE_BYTES, MUSIC_DOWNLOAD_PIECE_BYTES * 2]);
    expect(device.calls[0]!.headers).toEqual({ Authorization: "Bearer token" });
    expect(device.calls[0]!.url).toBe("https://yt.example/api/music/tracks/a/audio");
    const item = store.find("a")!;
    expect(item.state).toBe("done");
    expect(item.size).toBe(size);
    expect(store.localAudio("a")).toBe(`file:///data/downloads/${musicAudioFile(owner, "a")}`);
    expect(store.localArtwork("https://lh3/a.jpg")).toBe(`file:///data/downloads/${musicArtworkFile(owner, "https://lh3/a.jpg")}`);
    expect(musicDownloadBytes(store.view())).toBe(size);
    expect(musicDownloadedSingles(store.view()).map((entry) => entry.videoId)).toEqual(["a"]);
  });

  test("another profile on the same phone sees none of it and gets its own files", async () => {
    const { store, server } = await setup([["a", 10]]);
    await store.downloadTrack(track("a"));
    await flush();
    await store.connect({ owner: "https://yt.example#2", api: server.api });
    expect(store.find("a")).toBeNull();
    expect(store.localAudio("a")).toBeNull();
    expect(musicAudioFile("https://yt.example#1", "a")).not.toBe(musicAudioFile("https://yt.example#2", "a"));
  });

  test("signing out stops showing the last profile's music", async () => {
    const { store } = await setup([["a", 10]]);
    await store.downloadTrack(track("a"));
    await flush();
    await store.connect(null);
    expect(store.find("a")?.state).toBe("done");
    await store.signedOut();
    expect(store.find("a")).toBeNull();
  });

  test("an album downloads every song and its cover, and shows its progress", async () => {
    const { store, device } = await setup([["a", 10], ["b", 10]]);
    await store.downloadAlbum(album("X", [track("a"), track("b")]));
    expect(musicCollectionProgress(store.view(), store.collection("album", "X")).state).toBe("active");
    await flush();
    const progress = musicCollectionProgress(store.view(), store.collection("album", "X"));
    expect(progress).toEqual({ state: "done", fraction: 1, done: 2, count: 2 });
    expect(store.collection("album", "X")?.artwork).toBe(musicArtworkFile(store.owner!, "https://lh3/X-cover.jpg"));
    expect(device.files.has(musicAudioFile(store.owner!, "b"))).toBe(true);
  });

  test("removing an album deletes its songs unless they were saved on their own", async () => {
    const { store, device, owner } = await setup([["a", 10], ["b", 10]]);
    await store.downloadTrack(track("a"));
    await store.downloadAlbum(album("X", [track("a"), track("b")]));
    await flush();
    await store.removeCollection("album", "X");
    expect(store.find("a")?.state).toBe("done");
    expect(store.find("b")).toBeNull();
    expect(device.files.has(musicAudioFile(owner, "b"))).toBe(false);
    expect(device.files.has(musicArtworkFile(owner, "https://lh3/b.jpg"))).toBe(false);
    expect(device.files.has(musicArtworkFile(owner, "https://lh3/X-cover.jpg"))).toBe(false);
    expect(device.files.has(musicAudioFile(owner, "a"))).toBe(true);
    await store.removeAll();
    expect(store.tracks()).toEqual([]);
    expect(device.files.has(musicAudioFile(owner, "a"))).toBe(false);
  });

  test("your own playlist follows its edits, at once and on the next connect", async () => {
    const { store, server, device, owner } = await setup([["a", 10], ["b", 10], ["c", 10]]);
    const page = { id: "7", title: "Road trip", trackCount: 2, thumbnail: "", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
      tracks: [track("a"), track("b")] };
    server.mine.set("7", page);
    await store.downloadMyPlaylist(page);
    await flush();
    expect(store.collection("mine", "7")?.thumbnail).toBe("https://lh3/a.jpg");
    // Edited on this phone: the page that loads next brings the download along.
    await store.refresh("mine", { ...page, tracks: [track("b"), track("c")] });
    await flush();
    expect(store.collection("mine", "7")?.trackIds).toEqual(["b", "c"]);
    expect(device.files.has(musicAudioFile(owner, "a"))).toBe(false);
    expect(store.find("c")?.state).toBe("done");
    // Edited elsewhere (the website): picked up when the phone connects again.
    server.mine.set("7", { ...page, title: "Road trip 2", tracks: [track("c")] });
    await store.syncCollection("mine", "7");
    expect(store.collection("mine", "7")).toMatchObject({ title: "Road trip 2", trackIds: ["c"] });
    expect(store.find("b")).toBeNull();
  });

  test("a playlist picks up its changes the next time the server is reachable", async () => {
    const { store, server, device, owner } = await setup([["a", 10], ["b", 10], ["c", 10]]);
    const page: MusicPlaylistPage = { playlistId: "P", title: "Mine", subtitle: "You", thumbnail: null, tracks: [track("a"), track("b")] };
    server.playlists.set("P", page);
    await store.downloadPlaylist(page);
    await flush();
    server.playlists.set("P", { ...page, title: "Mine, renamed", tracks: [track("b"), track("c")] });
    await store.connect({ owner, accessToken: "token", api: server.api });
    await flush();
    expect(store.collection("playlist", "P")?.trackIds).toEqual(["b", "c"]);
    expect(store.collection("playlist", "P")?.title).toBe("Mine, renamed");
    expect(store.find("a")).toBeNull();
    expect(device.files.has(musicAudioFile(owner, "a"))).toBe(false);
    expect(store.find("c")?.state).toBe("done");
  });

  test("waits for Wi-Fi when asked to, and resumes a song from where it stopped", async () => {
    const size = MUSIC_DOWNLOAD_PIECE_BYTES * 2;
    const { store, device, clock } = await setup([["a", size]]);
    store.setWifiOnly(true);
    device.setMetered(true);
    await store.downloadTrack(track("a"));
    await flush();
    expect(device.calls).toEqual([]);
    expect(store.view().waiting).toBe("wifi");
    device.setMetered(false);
    clock.fire();
    await flush();
    expect(store.find("a")?.state).toBe("done");
    expect(store.view().waiting).toBeNull();

    const other = await setup([["b", size]]);
    await other.store.downloadTrack(track("b"));
    await flush();
    expect(other.store.find("b")?.state).toBe("done");
    // A network failure part way keeps the pieces already fetched.
    const third = await setup([["c", size + 1]]);
    let count = 0;
    const fetchRange = third.device.native.fetchRange;
    third.device.native.fetchRange = async (...args) => (++count === 2 ? { status: -1, size: args[3], total: -1 } : fetchRange(...args));
    await third.store.downloadTrack(track("c"));
    await flush();
    expect(third.store.find("c")).toMatchObject({ state: "downloading", downloaded: MUSIC_DOWNLOAD_PIECE_BYTES });
    expect(third.store.view().waiting).toBe("network");
    third.clock.fire();
    await flush();
    expect(third.store.find("c")?.state).toBe("done");
    // The failed request (not logged by the stand-in) is asked again from the same byte.
    expect(third.device.calls.map((call) => call.start)).toEqual([0, MUSIC_DOWNLOAD_PIECE_BYTES, MUSIC_DOWNLOAD_PIECE_BYTES * 2]);
  });

  test("a song the server won't send fails, and downloading it again retries", async () => {
    const { store, device } = await setup([["a", 10]]);
    device.setStatus(404);
    await store.downloadTrack(track("a"));
    await flush();
    expect(store.find("a")).toMatchObject({ state: "failed", error: "server" });
    device.setStatus(206);
    await store.downloadTrack(track("a"));
    await flush();
    expect(store.find("a")?.state).toBe("done");
  });

  test("keeps the index on disk and reads it back, dropping malformed entries", async () => {
    const { store, device } = await setup([["a", 10]]);
    await store.downloadTrack(track("a"));
    await flush();
    await store.settled();
    const again = new MusicDownloadStore(device.native);
    await again.ready;
    expect(again.find("a")?.state).toBe("done");
    expect(parseMusicDownloadIndex("{\"version\":1,\"tracks\":[{\"owner\":1}],\"collections\":[null]}").tracks).toEqual([]);
    expect(parseMusicDownloadIndex("not json").version).toBe(1);
  });

  test("listens played offline wait on the phone and are sent once the server is back", async () => {
    const { store, server, owner } = await setup();
    const play: MusicPlay = { videoId: "a", startedAt: "2026-11-15T10:00:00.000Z", listenedSeconds: 180, duration: 200, endReason: "completed" };
    store.queuePlay(play);
    server.setOnline(false);
    await store.flushPlays();
    expect(store.view().index.pendingPlays.length).toBe(1);
    server.setOnline(true);
    await store.connect({ owner, accessToken: "token", api: server.api });
    await flush();
    expect(server.plays).toEqual([play]);
    expect(store.view().index.pendingPlays).toEqual([]);
  });
});

describe("offline music API", () => {
  async function offline() {
    const context = await setup([["a", 10], ["b", 10], ["c", 10]]);
    await context.store.downloadAlbum(album("X", [track("a"), track("b", { rating: 1 })]));
    await context.store.downloadTrack(track("c", { artistId: "UCother" }));
    await context.store.downloadMyPlaylist({ id: "7", title: "Mine", trackCount: 1, thumbnail: "", createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z", tracks: [track("c", { artistId: "UCother" })] });
    await flush();
    const api = new OfflineMusicApi("https://yt.example", "token", context.store);
    const fetchFailing = globalThis.fetch;
    globalThis.fetch = (async () => { throw new TypeError("Network request failed"); }) as unknown as typeof fetch;
    return { ...context, api, restore: () => { globalThis.fetch = fetchFailing; } };
  }

  test("downloaded songs play from their file with their saved artwork", async () => {
    const { api, store, restore } = await offline();
    try {
      const player = api.playerTrack(track("a"));
      expect(player.url).toBe(store.localAudio("a")!);
      expect(player.artwork).toBe(store.localArtwork("https://lh3/a.jpg")!);
      expect(api.playerTrack(track("zzz")).url).toBe("https://yt.example/api/music/tracks/zzz/audio");
      expect(api.artworkSource("https://lh3/a.jpg")).toEqual({ uri: store.localArtwork("https://lh3/a.jpg")! });
    } finally { restore(); }
  });

  test("with no server the screens get the downloaded library", async () => {
    const { api, store, restore } = await offline();
    try {
      expect((await api.album("X")).tracks.map((entry) => entry.videoId)).toEqual(["a", "b"]);
      const library = await api.library();
      expect(library.liked.map((entry) => entry.videoId)).toEqual(["b"]);
      expect(library.albums.map((entry) => entry.browseId)).toEqual(["X"]);
      expect(library.playlists.map((entry) => [entry.id, entry.trackCount])).toEqual([["7", 1]]);
      expect((await api.myPlaylist("7")).tracks.map((entry) => entry.videoId)).toEqual(["c"]);
      expect(store.view().offline).toBe(true);
      expect((await api.search("song c")).tracks.map((entry) => entry.videoId)).toEqual(["c"]);
      expect((await api.artist("UCother")).topSongs.map((entry) => entry.videoId)).toEqual(["c"]);
      await expect(api.album("not-downloaded")).rejects.toThrow();
      expect((await api.station({ kind: "album", browseId: "X", startAt: "b" }, [], [], 10)).tracks.map((entry) => entry.videoId)).toEqual(["b"]);
      const mix = await api.station({ kind: "mix" }, ["a"], [], 10);
      expect(mix.tracks.map((entry) => entry.videoId).sort()).toEqual(["b", "c"]);
    } finally { restore(); }
  });

  test("a listen the server can't be told about is queued", async () => {
    const { api, store, restore } = await offline();
    try {
      await api.recordPlay({ videoId: "a", startedAt: "2026-11-15T10:00:00.000Z", listenedSeconds: 10, duration: 200, endReason: "skipped" });
      expect(store.view().index.pendingPlays.map((entry) => entry.play.videoId)).toEqual(["a"]);
    } finally { restore(); }
  });

  test("a downloaded song is ready at once and levelled with its saved loudness", async () => {
    const { api, store, restore } = await offline();
    try {
      // Unknown and the server unreachable: still ready, just not levelled.
      expect(await api.prepare("a")).toEqual({ ready: true, loudnessDb: null });
      expect(api.playerTrack(track("a")).loudnessDb).toBeNull();
      // Back online, the server's answer is kept with the download.
      globalThis.fetch = (async () => new Response(JSON.stringify({ ready: true, loudnessDb: 3.5 }), { status: 200 })) as unknown as typeof fetch;
      expect(await api.prepare("a")).toEqual({ ready: true, loudnessDb: 3.5 });
      expect(store.find("a")?.track.loudnessDb).toBe(3.5);
      // Offline again, the saved loudness levels it without asking.
      globalThis.fetch = (async () => { throw new TypeError("Network request failed"); }) as unknown as typeof fetch;
      expect(await api.prepare("a")).toEqual({ ready: true, loudnessDb: 3.5 });
      expect(api.playerTrack(track("a")).loudnessDb).toBe(3.5);
      // A song that isn't downloaded still needs the server.
      await expect(api.prepare("zzz")).rejects.toThrow("Network request failed");
    } finally { restore(); }
  });

  test("an offline song station plays that song first, then the other downloads", async () => {
    const { store } = await offline();
    const station = offlineStation(store, { kind: "track", videoId: "c" }, [], [], 10, () => 0);
    expect(station.seed).toBe("track:c");
    expect(station.tracks[0]!.videoId).toBe("c");
    expect(station.tracks.length).toBe(3);
    expect(offlineStation(store, { kind: "artist", artistId: "UCartist" }, [], ["a"], 10).tracks.map((entry) => entry.videoId)).toEqual(["b"]);
  });
});
