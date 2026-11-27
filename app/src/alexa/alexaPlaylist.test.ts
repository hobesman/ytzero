import { describe, expect, test } from "bun:test";
import type { MusicAudio } from "../music/musicAudio";
import { createAlexaRouter } from "../routes/alexaRoutes";
import { alexaAudioLink, alexaPlaylist, alexaPlaylistLink } from "./alexaAudioLinks";
import type { AlexaConfig } from "./alexaConfig";
import { nowPlayingChange } from "./alexaNowPlaying";
import { playDirective, playResponse } from "./alexaPlayback";

const SECRET = "a-test-secret-that-is-long-enough-123456";
const VIDEO = "abcdefghijk";
const settings: AlexaConfig = { musicSkillId: "amzn1.ask.skill.test", videoSkillId: "amzn1.ask.skill.video", profile: "1", secret: SECRET, publicUrl: "https://yt.example.com" };
const APP_PLAYLIST = [
  "#EXTM3U",
  `#EXT-X-MAP:URI="/api/videos/${VIDEO}/audio",BYTERANGE="723@0"`,
  "#EXTINF:9.98,",
  "#EXT-X-BYTERANGE:161875@3167",
  `/api/videos/${VIDEO}/audio`,
  "#EXT-X-ENDLIST",
  "",
].join("\n");

const FILE = new Uint8Array([1, 2, 3, 4]);
const audio = {
  prepare: async () => true,
  head: async () => null,
  audio: async (_userId: number, _videoId: string, range: string | null) => new Response(FILE, {
    status: 206,
    headers: { "Content-Type": "audio/mp4", "Content-Range": `bytes 0-3/4` , "X-Range": String(range) },
  }),
} as unknown as MusicAudio;

const router = (kind: "playlist" | "unsupported") => createAlexaRouter({
  config: () => settings,
  isChild: async () => false,
  videoPlayable: async () => true,
  audio: async () => ({ audio, ytdlpAvailable: async () => true }),
  vodPlaylist: async () => kind === "playlist" ? { kind, playlist: APP_PLAYLIST } : { kind },
});

describe("alexa playlists", () => {
  test("a playlist link is the file link with index.m3u8, signed the same", () => {
    const file = new URL(alexaAudioLink(settings.publicUrl, SECRET, VIDEO, 1, 1_000, "video"));
    const playlist = new URL(alexaPlaylistLink(settings.publicUrl, SECRET, VIDEO, 1, 1_000));
    expect(playlist.pathname).toBe(`/alexa/video-audio/${VIDEO}/index.m3u8`);
    expect(playlist.search).toBe(file.search);
  });

  test("points every segment at the signed Alexa file", () => {
    const link = `https://yt.example.com/alexa/video-audio/${VIDEO}?u=1&e=2&s=x`;
    const playlist = alexaPlaylist(APP_PLAYLIST, VIDEO, link);
    expect(playlist).not.toContain("/api/");
    expect(playlist).toContain(`#EXT-X-MAP:URI="${link}",BYTERANGE="723@0"`);
    expect(playlist.split("\n").filter((line) => line === link)).toHaveLength(1);
  });

  test("serves the playlist from a signed link, and the whole file when the audio can't be indexed", async () => {
    const link = new URL(alexaPlaylistLink(settings.publicUrl, SECRET, VIDEO, 1));
    const served = await router("playlist").request(`/video-audio/${VIDEO}/index.m3u8${link.search}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    expect(await served.text()).toContain(`https://yt.example.com/alexa/video-audio/${VIDEO}${link.search}`);

    const fallback = await router("unsupported").request(`/video-audio/${VIDEO}/index.m3u8${link.search}`);
    expect(fallback.status).toBe(200);
    expect(new Uint8Array(await fallback.arrayBuffer())).toEqual(FILE);

    expect((await router("playlist").request(`/video-audio/${VIDEO}/index.m3u8?u=1&e=9999999999&s=forged`)).status).toBe(403);
  });

  test("now playing reads the video from a playlist link", () => {
    const directive = playDirective({ track: { videoId: VIDEO, title: "T", artist: "A", thumbnail: "" }, url: alexaPlaylistLink(settings.publicUrl, SECRET, VIDEO, 1), token: `yv1.${VIDEO}`, behavior: "REPLACE_ALL", offsetInMilliseconds: 870_000 });
    const change = nowPlayingChange({ request: { type: "IntentRequest", intent: { name: "AMAZON.ResumeIntent" } } }, playResponse(null, directive));
    expect(change?.play).toMatchObject({ videoId: VIDEO, offsetMs: 870_000 });
  });
});
