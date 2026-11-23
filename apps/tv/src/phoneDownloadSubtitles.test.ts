import { describe, expect, test } from "bun:test";
import { parseSavedSubtitles, savedSubtitleFile, subtitlesToSave } from "./phoneDownloadSubtitles";
import { PhoneDownloadApi } from "./phoneDownloadApi";
import { downloadOwner, parseDownloadIndex, PhoneDownloadStore, type DownloadConnection } from "./phoneDownloads";
import type { NativeDownloadStatus, PhoneDownloadsNative } from "./phoneDownloadsNative";
import { resetSubtitleMemory, saveSubtitleMemory } from "./subtitles";
import type { Video } from "./types";

const track = (lang: string) => ({ lang, url: `/api/videos/v1/subtitles/${lang}` });
const video = (patch: Partial<Video> = {}): Video => ({
  video_id: "v1", title: "Video", description: "", thumbnail: "", channel_title: "Channel",
  published_at: null, duration: "10:00", live_status: "none", watched: 0, status: "inbox", ...patch,
});

function fakeNative() {
  const files = new Map<string, string>();
  const fetched: { url: string; headers: Record<string, string>; name: string }[] = [];
  const statuses = new Map<string, NativeDownloadStatus>();
  let failing = "";
  const native: PhoneDownloadsNative = {
    directoryUri: () => "file:///data/downloads/",
    enqueue: async (_url, _headers, name) => { statuses.set("1", { id: "1", status: "done" }); files.set(`${name}.part`, ""); return "1"; },
    query: async (ids) => ids.map((id) => statuses.get(id) ?? { id, status: "missing" }),
    finish: async (_id, name) => { files.set(name, "video"); return 100; },
    cancel: async () => true,
    fetchFile: async (url, headers, name) => {
      fetched.push({ url, headers, name });
      if (failing && url.endsWith(failing)) return -1;
      files.set(name, `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${name}`);
      return 50;
    },
    fetchRange: async () => ({ status: -1, size: 0, total: -1 }),
    completePart: async () => -1,
    isMetered: () => false,
    readText: async (name) => files.get(name) ?? null,
    writeText: async (name, text) => { files.set(name, text); return true; },
    deleteFile: async (name) => files.delete(name),
    fileSize: async () => 1,
    freeBytes: async () => 1e9,
  };
  return { native, files, fetched, fail: (suffix: string) => { failing = suffix; } };
}

const owner = downloadOwner("https://tube.test", 1);
const flush = async () => { for (let round = 0; round < 5; round++) await new Promise((resolve) => setTimeout(resolve, 0)); };

async function store(tracks = [track("de"), track("en"), track("fr"), track("ja")], settings = { player_cc_lang: "fr", player_hl: "en" }) {
  const fake = fakeNative();
  const api: DownloadConnection["api"] = {
    requestDeviceDownload: async () => ({ ok: true }),
    videoDownload: async () => ({ download: { status: "done" }, progress: null }),
    savePlaybackProgress: async () => ({}),
    markWatched: async () => ({}),
    thumbnailSource: () => ({}),
    videoSubtitles: async () => ({ subtitles: tracks, available: tracks.map((item) => ({ lang: item.lang, label: `Label ${item.lang}` })) }),
    settings: async () => ({ settings }),
  };
  const downloads = new PhoneDownloadStore(fake.native, { now: () => 1, setTimeout: () => 1, clearTimeout: () => {} });
  await downloads.connect({ owner, instanceUrl: "https://tube.test/", accessToken: "token", api });
  return { ...fake, downloads };
}

/** Takes a download through the server and the phone to done. */
async function finish(downloads: PhoneDownloadStore) {
  await downloads.poll();
  await downloads.poll();
  await flush();
}

describe("subtitles saved with phone downloads", () => {
  test("choose the viewer's languages, at most three, with no language twice", () => {
    const tracks = [track("de"), track("en-US"), track("fr"), track("ja"), track("pl")];
    expect(subtitlesToSave(tracks, ["en", null, "en-GB", "fr"]).map((item) => item.lang)).toEqual(["en-US", "fr"]);
    expect(subtitlesToSave(tracks, ["pl", "de", "fr", "ja"]).map((item) => item.lang)).toEqual(["pl", "de", "fr"]);
    expect(subtitlesToSave(tracks, ["ru"])).toEqual([]);
  });

  test("name their files beside the video's", () => {
    expect(savedSubtitleFile("abc-v1", "pt-BR")).toBe("abc-v1.pt-BR.vtt");
    expect(savedSubtitleFile("abc-v1", "x/../y")).toBe("abc-v1.x____y.vtt");
  });

  test("are fetched with the download, in the profile's and channel's languages", async () => {
    resetSubtitleMemory();
    const { downloads, fetched } = await store();
    await downloads.download(video({ channel_caption_language: "de" }));
    await flush();
    const item = downloads.find("v1")!;
    const base = item.file.replace(/\.mp4$/, "");
    expect(item.subtitles).toEqual([
      { lang: "de", label: "Label de", file: `${base}.de.vtt` },
      { lang: "fr", label: "Label fr", file: `${base}.fr.vtt` },
      { lang: "en", label: "Label en", file: `${base}.en.vtt` },
    ]);
    expect(fetched.find((entry) => entry.name === `${base}.de.vtt`)).toEqual({
      url: "https://tube.test/api/videos/v1/subtitles/de", headers: { Authorization: "Bearer token" }, name: `${base}.de.vtt`,
    });
  });

  test("put the language last picked in the player first, and skip it when that was Off", async () => {
    resetSubtitleMemory();
    await saveSubtitleMemory({ getItemAsync: async () => null, setItemAsync: async () => {} }, "ja");
    const picked = await store();
    await picked.downloads.download(video());
    await flush();
    expect(picked.downloads.find("v1")!.subtitles!.map((item) => item.lang)).toEqual(["ja", "fr", "en"]);

    await saveSubtitleMemory({ getItemAsync: async () => null, setItemAsync: async () => {} }, "off");
    const off = await store();
    await off.downloads.download(video());
    await flush();
    expect(off.downloads.find("v1")!.subtitles!.map((item) => item.lang)).toEqual(["fr", "en"]);
    resetSubtitleMemory();
  });

  test("play from the phone once the video is done, and leave with it", async () => {
    resetSubtitleMemory();
    const { downloads, files } = await store();
    await downloads.download(video());
    await flush();
    expect(downloads.localSubtitles("v1")).toEqual([]);
    await finish(downloads);
    expect(downloads.find("v1")?.state).toBe("done");
    const local = downloads.localSubtitles("v1");
    expect(local.map((item) => item.lang)).toEqual(["fr", "en"]);
    expect(local[0]!.url).toMatch(/^file:\/\/\/data\/downloads\/[a-z0-9]+-v1\.fr\.vtt$/);
    expect(await downloads.readSubtitle(local[0]!.url)).toContain("WEBVTT");
    expect(await downloads.readSubtitle("/api/videos/v1/subtitles/fr")).toBeNull();
    expect(await downloads.readSubtitle("file:///data/downloads/index.json")).toBeNull();

    await downloads.remove("v1");
    expect([...files.keys()].filter((name) => name.endsWith(".vtt"))).toEqual([]);
  });

  test("a track that fails, or a video without tracks, does not stop the download", async () => {
    resetSubtitleMemory();
    const failing = await store();
    failing.fail("/fr");
    await failing.downloads.download(video());
    await flush();
    expect(failing.downloads.find("v1")!.subtitles!.map((item) => item.lang)).toEqual(["en"]);

    const none = await store([]);
    await none.downloads.download(video());
    await finish(none.downloads);
    expect(none.downloads.find("v1")).toMatchObject({ state: "done" });
    expect(none.downloads.find("v1")!.subtitles).toBeUndefined();
  });

  test("survive a restart and drop malformed entries", () => {
    expect(parseSavedSubtitles([{ lang: "en", label: "English", file: "a-v1.en.vtt" }, { lang: "x", label: "X", file: "../index.json" }, null]))
      .toEqual([{ lang: "en", label: "English", file: "a-v1.en.vtt" }]);
    expect(parseSavedSubtitles(undefined)).toBeUndefined();
    const index = parseDownloadIndex(JSON.stringify({ version: 1, downloads: [{
      owner, videoId: "v1", file: "a-v1.mp4", state: "done", video: video(), subtitles: [{ lang: "en", label: "English", file: "a-v1.en.vtt" }],
    }] }));
    expect(index.downloads[0]!.subtitles).toEqual([{ lang: "en", label: "English", file: "a-v1.en.vtt" }]);
  });
});

describe("the player's subtitle list for a downloaded video", () => {
  test("uses the saved copies online, adds saved languages the server lost, and has only them offline", async () => {
    resetSubtitleMemory();
    const { downloads } = await store();
    await downloads.download(video());
    await finish(downloads);
    const api = new PhoneDownloadApi("https://tube.test", "token", downloads);
    const realFetch = globalThis.fetch;
    let online = true;
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (!online) throw new TypeError("Network request failed");
      expect(String(input)).toBe("https://tube.test/api/videos/v1/subtitles");
      return new Response(JSON.stringify({ subtitles: [track("en"), track("de")] }), { status: 200 });
    }) as typeof fetch;
    try {
      const listed = (await api.videoSubtitles("v1")).subtitles;
      expect(listed.map((item) => item.lang)).toEqual(["en", "de", "fr"]);
      expect(listed[0]!.url).toMatch(/^file:.*\.en\.vtt$/);
      expect(listed[1]!.url).toBe("/api/videos/v1/subtitles/de");
      expect(await api.subtitleText(listed[0]!.url)).toContain("WEBVTT");

      online = false;
      expect((await api.videoSubtitles("v1")).subtitles.map((item) => item.lang)).toEqual(["fr", "en"]);
      await expect(api.videoSubtitles("other")).rejects.toThrow("Network request failed");
    } finally { globalThis.fetch = realFetch; }
  });
});
