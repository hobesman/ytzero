import { describe, expect, test } from "bun:test";
import { sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StoredMusicTrack } from "../music/musicCatalog";
import type { MusicPlay } from "../music/musicPlays";
import type { StationSeed } from "../music/musicStation";
import { createAlexaRouter } from "../routes/alexaRoutes";
import { alexaAudioLink, ALEXA_AUDIO_LINK_TTL_MS, verifyAlexaAudioLink } from "./alexaAudioLinks";
import { alexaConfig, alexaStartupStatus, type AlexaConfig } from "./alexaConfig";
import { decodePlaybackToken, encodePlaybackToken, SERVED_HISTORY_LIMIT, SKIPPED_HISTORY_LIMIT } from "./alexaPlayback";
import { createAlexaSignatureVerifier, validCertificateUrl } from "./alexaSignature";
import { createAlexaSkill, type AlexaEnvelope } from "./alexaSkill";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
const SECRET = "s".repeat(40);
const NOW = Date.parse("2030-06-01T12:00:00Z");
const id = (n: number) => `vid${String(n).padStart(8, "0")}`;

describe("alexa audio links", () => {
  test("verify only the profile, song and lifetime they were signed for", () => {
    const link = new URL(alexaAudioLink("https://yt.example.com", SECRET, id(1), 7, NOW));
    expect(link.pathname).toBe(`/alexa/audio/${id(1)}`);
    expect(verifyAlexaAudioLink(SECRET, id(1), link.searchParams, NOW)).toBe(7);
    expect(verifyAlexaAudioLink(SECRET, id(2), link.searchParams, NOW)).toBeNull();
    expect(verifyAlexaAudioLink("x".repeat(40), id(1), link.searchParams, NOW)).toBeNull();
    expect(verifyAlexaAudioLink(SECRET, id(1), link.searchParams, NOW + ALEXA_AUDIO_LINK_TTL_MS + 1000)).toBeNull();
    const otherProfile = new URLSearchParams(link.searchParams);
    otherProfile.set("u", "8");
    expect(verifyAlexaAudioLink(SECRET, id(1), otherProfile, NOW)).toBeNull();
  });
});

describe("alexa config", () => {
  const complete = { YTZERO_ALEXA_SKILL_ID: "amzn1.ask.skill.test", YTZERO_ALEXA_PROFILE: "Nick", YTZERO_ALEXA_SECRET: SECRET, APP_URL: "https://yt.example.com/" };

  test("is on only when every part is set and the address is https", () => {
    expect(alexaConfig(complete)).toEqual({ musicSkillId: "amzn1.ask.skill.test", videoSkillId: null, profile: "Nick", secret: SECRET, publicUrl: "https://yt.example.com" });
    expect(alexaConfig({ ...complete, YTZERO_ALEXA_SKILL_ID: "" })).toHaveProperty("disabled");
    expect(alexaConfig({ ...complete, YTZERO_ALEXA_SKILL_ID: "", YTZERO_ALEXA_VIDEO_SKILL_ID: "amzn1.ask.skill.video" }))
      .toMatchObject({ musicSkillId: null, videoSkillId: "amzn1.ask.skill.video" });
    expect(alexaConfig({ ...complete, YTZERO_ALEXA_VIDEO_SKILL_ID: "amzn1.ask.skill.test" })).toHaveProperty("disabled");
    expect(alexaConfig({ ...complete, YTZERO_ALEXA_PROFILE: undefined })).toHaveProperty("disabled");
    expect(alexaConfig({ ...complete, YTZERO_ALEXA_SECRET: "short" })).toHaveProperty("disabled");
    expect(alexaConfig({ ...complete, APP_URL: "http://yt.example.com" })).toHaveProperty("disabled");
    expect(alexaConfig({ ...complete, YTZERO_ALEXA_PUBLIC_URL: "https://alexa.example.com/yt" })).toMatchObject({ publicUrl: "https://alexa.example.com/yt" });
  });

  test("names a value kept in quote marks instead of calling it invalid", () => {
    expect(alexaConfig({ ...complete, APP_URL: "\"https://yt.example.com\"" })).toEqual({ disabled: "APP_URL is wrapped in quote marks; remove them" });
  });

  test("startup says whether the skill is on, and why not once it's half set up", () => {
    expect(alexaStartupStatus(complete)).toEqual({ event: "alexa.enabled", fields: { profile: "Nick", endpoint: "https://yt.example.com/alexa", skills: "music" } });
    expect(alexaStartupStatus({ ...complete, YTZERO_ALEXA_SECRET: "short" })).toEqual({ event: "alexa.disabled", fields: { reason: "YTZERO_ALEXA_SECRET must be at least 32 characters" } });
    expect(alexaStartupStatus({ APP_URL: "https://yt.example.com" })).toBeNull();
  });
});

describe("alexa request signatures", () => {
  const CERT_URL = "https://s3.amazonaws.com/echo.api/echo-api-cert.pem";
  const body = JSON.stringify({ request: { type: "LaunchRequest", timestamp: new Date(NOW).toISOString() } });
  const signed = (text: string) => sign("sha256", Buffer.from(text), fixture("signing.key")).toString("base64");
  const headers = (signature: string, url = CERT_URL) => new Headers({ SignatureCertChainUrl: url, "Signature-256": signature });
  const verifier = (chain = fixture("signing.pem"), roots = [fixture("root.pem")]) => createAlexaSignatureVerifier({
    fetchCertificateChain: async () => chain,
    trustedRoots: roots,
    now: () => NOW,
  });

  test("certificate URLs follow Amazon's rules", () => {
    expect(validCertificateUrl(CERT_URL)).not.toBeNull();
    expect(validCertificateUrl("https://s3.amazonaws.com:443/echo.api/../echo.api/echo-api-cert.pem")).not.toBeNull();
    expect(validCertificateUrl("HTTPS://S3.AMAZONAWS.COM/echo.api/cert.pem")).not.toBeNull();
    expect(validCertificateUrl("http://s3.amazonaws.com/echo.api/cert.pem")).toBeNull();
    expect(validCertificateUrl("https://notamazon.com/echo.api/cert.pem")).toBeNull();
    expect(validCertificateUrl("https://s3.amazonaws.com/EcHo.aPi/cert.pem")).toBeNull();
    expect(validCertificateUrl("https://s3.amazonaws.com/invalid.path/cert.pem")).toBeNull();
    expect(validCertificateUrl("https://s3.amazonaws.com:563/echo.api/cert.pem")).toBeNull();
    expect(validCertificateUrl("https://s3.amazonaws.com/echo.api/../invalid.path/cert.pem")).toBeNull();
  });

  test("accepts a body signed by a trusted signing certificate", async () => {
    const chain = `${fixture("signing.pem")}\n${fixture("root.pem")}`;
    expect(await verifier(chain).check(headers(signed(body)), body, new Date(NOW).toISOString())).toBeNull();
    expect(await verifier().check(headers(signed(body)), body, new Date(NOW).toISOString())).toBeNull();
  });

  // Amazon's chain ends with a trusted root cross-signed by a retired one that
  // trust stores no longer carry; the chain is trusted at the trusted root.
  test("accepts a chain ending in a cross-signed copy of a trusted root", async () => {
    const chain = `${fixture("anchor-signing.pem")}\n${fixture("anchor-cross.pem")}`;
    const timestamp = new Date(NOW).toISOString();
    expect(await verifier(chain, [fixture("anchor-root.pem")]).check(headers(signed(body)), body, timestamp)).toBeNull();
    expect(await verifier(chain, [fixture("old.pem"), fixture("root.pem")]).check(headers(signed(body)), body, timestamp)).toBeNull();
    expect(await verifier(chain, [fixture("root.pem")]).check(headers(signed(body)), body, timestamp)).toBe("untrusted certificate");
  });

  test("refuses altered, stale, wrongly hosted or untrusted requests", async () => {
    const timestamp = new Date(NOW).toISOString();
    expect(await verifier().check(headers(signed(body)), body.replace("Launch", "Intent"), timestamp)).toBe("invalid signature");
    expect(await verifier().check(headers(signed(body)), body, new Date(NOW - 200_000).toISOString())).toBe("stale request");
    expect(await verifier().check(headers(signed(body), "https://evil.example.com/echo.api/c.pem"), body, timestamp)).toBe("invalid certificate url");
    expect(await verifier(fixture("wronghost.pem")).check(headers(signed(body)), body, timestamp)).toBe("untrusted certificate");
    expect(await verifier(fixture("signing.pem"), []).check(headers(signed(body)), body, timestamp)).toBe("untrusted certificate");
    expect(await verifier().check(new Headers({ SignatureCertChainUrl: CERT_URL }), body, timestamp)).toBe("missing signature");
  });
});

describe("alexa playback tokens", () => {
  test("round-trip and stay under Alexa's 1024-character limit", () => {
    const state = {
      seed: { kind: "album", browseId: "MPREb_abcdefghijk", startAt: id(1) } as StationSeed,
      videoId: id(99),
      served: Array.from({ length: 60 }, (_, n) => id(n)),
      skipped: Array.from({ length: 30 }, (_, n) => id(n)),
      failures: 2,
    };
    const token = encodePlaybackToken(state);
    expect(token.length).toBeLessThan(1024);
    expect(decodePlaybackToken(token)).toEqual({
      ...state,
      served: state.served.slice(-SERVED_HISTORY_LIMIT),
      skipped: state.skipped.slice(-SKIPPED_HISTORY_LIMIT),
    });
    expect(decodePlaybackToken("yz1.garbage")).toBeNull();
    expect(decodePlaybackToken("someone-else")).toBeNull();
  });
});

const track = (n: number, extra: Partial<StoredMusicTrack> = {}): StoredMusicTrack => ({
  videoId: id(n), title: `Song ${n}`, artist: "Artist", artistId: null, album: null, duration: 200,
  thumbnail: "https://i.ytimg.com/x.jpg", isTopic: true, songKey: `song-${n}`, ...extra,
} as StoredMusicTrack);

function skillHarness(albumTracks: StoredMusicTrack[] = []) {
  const stationCalls: { seed: StationSeed; served: readonly string[]; skipped: readonly string[] }[] = [];
  const plays: MusicPlay[] = [];
  const prepared: string[] = [];
  let counter = 100;
  const skill = createAlexaSkill({
    client: {
      searchSongs: async () => [track(1)],
      searchAll: async () => ({ albums: [{ browseId: "MPREb_abcdefghijk", title: "Record", artist: "Band", artistId: null, year: null, thumbnail: "", kind: "album" }], artists: [{ channelId: "UCabcdefghijklmnopqrstuv", name: "Band", thumbnail: "" }] }),
    },
    stations: {
      next: async (_userId, seed, served, skipped) => {
        stationCalls.push({ seed, served, skipped });
        if (seed.kind === "album" && !served.length) return albumTracks;
        if (seed.kind === "track" && !served.length) return [track(1)];
        return [track(counter++)];
      },
    },
    prepare: (_userId, videoId) => { prepared.push(videoId); },
    audioLink: (videoId, userId) => `https://yt.example.com/alexa/audio/${videoId}?u=${userId}`,
    recordPlay: async (_userId, play) => { plays.push(play); },
    findTrack: async (videoId) => track(Number(videoId.slice(3)), { videoId }),
    saveTracks: async (tracks) => tracks as StoredMusicTrack[],
    findGenre: async (_userId, spoken) => spoken.includes("80s") ? { playlistId: "RDCLAK5uy_lMzHW51iFg1Kx0d_2EHpzbOgCrwtu8cgI", title: "The Hits: '80s", subtitle: "", thumbnail: "" } : null,
  });
  return { skill, stationCalls, plays, prepared };
}

const intent = (name: string, query?: string, player?: { token: string; offsetInMilliseconds?: number }): AlexaEnvelope => ({
  context: { AudioPlayer: player },
  request: { type: "IntentRequest", timestamp: new Date(NOW).toISOString(), intent: { name, slots: query ? { query: { value: query } } : {} } },
});
const event = (type: string, token: string, offsetInMilliseconds = 0, at = NOW): AlexaEnvelope => ({
  request: { type, token, offsetInMilliseconds, timestamp: new Date(at).toISOString() },
});
type Directive = { type: string; playBehavior?: string; audioItem: { stream: { url: string; token: string; offsetInMilliseconds: number; expectedPreviousToken?: string } } };
const directiveOf = (response: { response: Record<string, unknown> }) => (response.response.directives as Directive[])[0];

describe("alexa skill", () => {
  test("songs by an artist play only the artist; an artist's radio keeps the radio flag in the token", async () => {
    const { skill, stationCalls } = skillHarness();
    const only = await skill.handle(7, intent("PlayArtistIntent", "band"));
    expect(only.response.outputSpeech).toEqual({ type: "PlainText", text: "Playing songs by Band." });
    expect(stationCalls[0].seed).toEqual({ kind: "artist", artistId: "UCabcdefghijklmnopqrstuv" });

    const radio = await skill.handle(7, intent("PlayArtistRadioIntent", "band"));
    expect(radio.response.outputSpeech).toEqual({ type: "PlainText", text: "Playing Band radio." });
    const seed = { kind: "artist", artistId: "UCabcdefghijklmnopqrstuv", radio: true };
    expect(stationCalls[1].seed).toEqual(seed as StationSeed);
    const token = directiveOf(radio).audioItem.stream.token;
    await skill.handle(7, event("AudioPlayer.PlaybackNearlyFinished", token));
    expect(stationCalls[2].seed).toEqual(seed as StationSeed);
  });

  test("plays a requested song, then queues the station after it", async () => {
    const { skill, prepared } = skillHarness();
    const started = await skill.handle(7, intent("PlaySongIntent", "song one"));
    expect(started.response.outputSpeech).toEqual({ type: "PlainText", text: "Playing Song 1 by Artist." });
    const play = directiveOf(started);
    expect(play.playBehavior).toBe("REPLACE_ALL");
    expect(play.audioItem.stream.url).toBe(`https://yt.example.com/alexa/audio/${id(1)}?u=7`);
    expect(prepared).toEqual([id(1)]);

    const queued = directiveOf(await skill.handle(7, event("AudioPlayer.PlaybackNearlyFinished", play.audioItem.stream.token)));
    expect(queued.playBehavior).toBe("ENQUEUE");
    expect(queued.audioItem.stream.expectedPreviousToken).toBe(play.audioItem.stream.token);
    expect(decodePlaybackToken(queued.audioItem.stream.token)).toMatchObject({ videoId: id(100), served: [id(1)], skipped: [] });
  });

  test("plays an album in order before turning it into a station", async () => {
    const { skill } = skillHarness([track(1), track(2)]);
    const first = directiveOf(await skill.handle(7, intent("PlayAlbumIntent", "record")));
    const second = directiveOf(await skill.handle(7, event("AudioPlayer.PlaybackNearlyFinished", first.audioItem.stream.token)));
    expect(decodePlaybackToken(second.audioItem.stream.token)?.videoId).toBe(id(2));
    const third = directiveOf(await skill.handle(7, event("AudioPlayer.PlaybackNearlyFinished", second.audioItem.stream.token)));
    expect(decodePlaybackToken(third.audioItem.stream.token)).toMatchObject({ videoId: id(100), served: [id(1), id(2)] });
  });

  test("plays a genre as a station from YouTube Music's playlist for it", async () => {
    const { skill, stationCalls } = skillHarness();
    const started = await skill.handle(7, intent("PlayGenreIntent", "80s music"));
    expect(started.response.outputSpeech).toEqual({ type: "PlainText", text: "Playing The Hits: '80s." });
    expect(stationCalls[0].seed).toEqual({ kind: "playlist", playlistId: "RDCLAK5uy_lMzHW51iFg1Kx0d_2EHpzbOgCrwtu8cgI" });
    expect(decodePlaybackToken(directiveOf(started).audioItem.stream.token)?.seed).toEqual(stationCalls[0].seed);
    const missing = await skill.handle(7, intent("PlayGenreIntent", "sea shanties"));
    expect(missing.response.outputSpeech).toEqual({ type: "PlainText", text: "I couldn't find a playlist for sea shanties." });
  });

  test("next skips, and the skipped listen is recorded as skipped", async () => {
    const { skill, stationCalls, plays } = skillHarness();
    const token = directiveOf(await skill.handle(7, intent("PlaySongIntent", "song one"))).audioItem.stream.token;
    await skill.handle(7, event("AudioPlayer.PlaybackStarted", token, 0, NOW));
    const next = directiveOf(await skill.handle(7, intent("AMAZON.NextIntent", undefined, { token })));
    expect(next.playBehavior).toBe("REPLACE_ALL");
    expect(stationCalls.at(-1)?.skipped).toEqual([id(1)]);
    await skill.handle(7, event("AudioPlayer.PlaybackStopped", token, 30_000, NOW + 30_000));
    expect(plays).toEqual([{ videoId: id(1), startedAt: new Date(NOW), listenedSeconds: 30, duration: 200, endReason: "skipped", stationSeed: `track:${id(1)}` }]);
  });

  test("pause stops, resume continues from the same place as one listen", async () => {
    const { skill, plays } = skillHarness();
    const token = directiveOf(await skill.handle(7, intent("PlaySongIntent", "song one"))).audioItem.stream.token;
    await skill.handle(7, event("AudioPlayer.PlaybackStarted", token, 0, NOW));
    expect(directiveOf(await skill.handle(7, intent("AMAZON.PauseIntent")))).toEqual({ type: "AudioPlayer.Stop" } as never);
    await skill.handle(7, event("AudioPlayer.PlaybackStopped", token, 45_000, NOW + 45_000));
    const resumed = directiveOf(await skill.handle(7, intent("AMAZON.ResumeIntent", undefined, { token, offsetInMilliseconds: 45_000 })));
    expect(resumed.audioItem.stream).toMatchObject({ token, offsetInMilliseconds: 45_000 });
    await skill.handle(7, event("AudioPlayer.PlaybackStarted", token, 45_000, NOW + 3_600_000));
    await skill.handle(7, event("AudioPlayer.PlaybackFinished", token, 200_000, NOW + 3_800_000));
    expect(plays.map((play) => [play.startedAt.getTime(), play.endReason, play.listenedSeconds])).toEqual([[NOW, "stopped", 45], [NOW, "completed", 200]]);
  });

  test("a song that breaks off starts again where it stopped, and moves on only if it fails again", async () => {
    const { skill } = skillHarness();
    const token = directiveOf(await skill.handle(7, intent("PlaySongIntent", "song one"))).audioItem.stream.token;
    const failed: AlexaEnvelope = {
      ...event("AudioPlayer.PlaybackFailed", token),
      request: { ...event("AudioPlayer.PlaybackFailed", token).request, currentPlaybackState: { token, offsetInMilliseconds: 95_000, playerActivity: "PLAYING" } },
    };
    const retry = directiveOf(await skill.handle(7, failed));
    expect(retry.playBehavior).toBe("REPLACE_ALL");
    expect(retry.audioItem.stream.offsetInMilliseconds).toBe(95_000);
    expect(decodePlaybackToken(retry.audioItem.stream.token)).toMatchObject({ videoId: id(1), served: [], failures: 1, retried: true });

    const next = directiveOf(await skill.handle(7, event("AudioPlayer.PlaybackFailed", retry.audioItem.stream.token)));
    expect(decodePlaybackToken(next.audioItem.stream.token)).toMatchObject({ videoId: id(100), served: [id(1)], failures: 2 });
    expect(decodePlaybackToken(next.audioItem.stream.token)?.retried).toBeUndefined();
    expect(next.audioItem.stream.offsetInMilliseconds).toBe(0);
  });

  test("a stream that keeps failing stops instead of skipping forever", async () => {
    const { skill } = skillHarness();
    let token = directiveOf(await skill.handle(7, intent("PlaySongIntent", "song one"))).audioItem.stream.token;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = directiveOf(await skill.handle(7, event("AudioPlayer.PlaybackFailed", token)));
      expect(retry.playBehavior).toBe("REPLACE_ALL");
      token = retry.audioItem.stream.token;
    }
    expect(directiveOf(await skill.handle(7, event("AudioPlayer.PlaybackFailed", token)))).toEqual({ type: "AudioPlayer.Stop" } as never);
  });

  test("audio events never answer with speech", async () => {
    const { skill } = skillHarness();
    for (const type of ["AudioPlayer.PlaybackNearlyFinished", "PlaybackController.NextCommandIssued", "PlaybackController.PlayCommandIssued"]) {
      expect((await skill.handle(7, { ...event(type, "not-ours"), context: { AudioPlayer: { token: "not-ours" } } })).response.outputSpeech).toBeUndefined();
    }
  });
});

describe("alexa routes", () => {
  const settings: AlexaConfig = { musicSkillId: "amzn1.ask.skill.test", videoSkillId: "amzn1.ask.skill.video", profile: "1", secret: SECRET, publicUrl: "https://yt.example.com" };
  const launch = (skillId: string) => JSON.stringify({ context: { System: { application: { applicationId: skillId } } }, request: { type: "LaunchRequest" } });
  const router = (reason: string | null = null) => createAlexaRouter({
    config: () => settings,
    verifier: { check: async () => reason },
    resolveProfile: async () => 1,
    isChild: async () => false,
  });

  test("answers only signed requests for its own skill", async () => {
    const ok = await router().request("/", { method: "POST", body: launch(settings.musicSkillId!) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).response.outputSpeech.text).toBe("What would you like to hear?");
    expect((await router().request("/", { method: "POST", body: launch("amzn1.ask.skill.other") })).status).toBe(400);
    expect((await router("invalid signature").request("/", { method: "POST", body: launch(settings.musicSkillId!) })).status).toBe(400);
  });

  test("sends each skill's requests to that skill", async () => {
    const video = await router().request("/", { method: "POST", body: launch(settings.videoSkillId!) });
    expect((await video.json()).response.outputSpeech.text).toBe("Which video would you like to hear?");
  });

  test("a song link never opens a video, nor the other way round", async () => {
    const songLink = new URL(alexaAudioLink(settings.publicUrl, SECRET, id(1), 1, Date.now(), "music"));
    const videoLink = new URL(alexaAudioLink(settings.publicUrl, SECRET, id(1), 1, Date.now(), "video"));
    expect(videoLink.pathname).toBe(`/alexa/video-audio/${id(1)}`);
    expect((await router().request(`/video-audio/${id(1)}${songLink.search}`)).status).toBe(403);
    expect((await router().request(`/audio/${id(1)}${videoLink.search}`)).status).toBe(403);
    const unplayable = createAlexaRouter({ config: () => settings, isChild: async () => false, videoPlayable: async () => false });
    expect((await unplayable.request(`/video-audio/${id(1)}${videoLink.search}`)).status).toBe(404);
  });

  test("is invisible when not configured", async () => {
    const off = createAlexaRouter({ config: () => ({ disabled: "YTZERO_ALEXA_SKILL_ID is not set" }) });
    expect((await off.request("/", { method: "POST", body: "{}" })).status).toBe(404);
    expect((await off.request(`/audio/${id(1)}`)).status).toBe(404);
  });

  test("audio needs a valid signed link", async () => {
    expect((await router().request(`/audio/${id(1)}?u=1&e=9999999999&s=forged`)).status).toBe(403);
  });
});
