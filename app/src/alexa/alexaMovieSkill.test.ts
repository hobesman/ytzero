import { describe, expect, test } from "bun:test";
import type { PlexItem, PlexSummary } from "../plex/plexClient";
import { createAlexaMovieSkill, decodeMovieToken, encodeMovieToken, movieResumePosition, nextUp, parseEpisodeRequest, watchedFrom, type MovieApi } from "./alexaMovieSkill";
import type { AlexaEnvelope } from "./alexaSkill";

const title = (fields: Partial<PlexItem> & Pick<PlexItem, "id" | "title">): PlexItem => ({
  type: "movie", year: null, show: null, season: null, episode: null, duration: 6_000, viewOffset: 0, watched: false,
  partKey: `/library/parts/${fields.id}/1/file.mkv`, audio: [], chapters: [], thumb: "", contentRating: "", lastViewedAt: 0, ...fields,
});
const episode = (id: string, season: number, number: number, fields: Partial<PlexItem> = {}) => title({
  id, title: `Episode ${number}`, type: "episode", show: { id: "200", title: "The Office" }, season, episode: number, duration: 1_300, ...fields,
});

const HEAT = title({ id: "101", title: "Heat", year: 1995, duration: 10_200, viewOffset: 3_600,
  chapters: [{ start: 0, end: 600, title: "Opening" }, { start: 600, end: 1_800, title: "The Heist" }, { start: 1_800, end: 10_200, title: "After" }] });

/** Plex, mocked: a movie and a show of four episodes, the first two watched. */
function fakePlex(overrides: { episodes?: PlexItem[]; deck?: PlexItem[] } = {}) {
  const episodes = overrides.episodes ?? [
    episode("201", 1, 1, { watched: true }), episode("202", 1, 2, { watched: true }), episode("203", 2, 1), episode("204", 2, 2),
  ];
  const items = new Map<string, PlexItem>([[HEAT.id, HEAT], ...episodes.map((item) => [item.id, item] as const)]);
  const summaries: PlexSummary[] = [
    { id: "101", type: "movie", title: "Heat", year: 1995, showTitle: null },
    { id: "200", type: "show", title: "The Office", year: 2005, showTitle: null },
  ];
  const saved: { id: string; seconds: number; state: string }[] = [];
  const watched: string[] = [];
  const api: MovieApi = {
    search: async (query) => summaries.filter((summary) => summary.title.toLowerCase().includes(query.toLowerCase().split(" ")[0]!)),
    item: async (id) => items.get(id) ?? null,
    episodes: async () => episodes,
    onDeck: async () => overrides.deck ?? [HEAT],
    saveProgress: async (id, seconds, state = "stopped") => { saved.push({ id, seconds, state }); },
    markWatched: async (id) => { watched.push(id); },
  };
  return { api, saved, watched };
}

function skillWith(api: MovieApi, clock = { now: 1_000_000 }) {
  const skill = createAlexaMovieSkill({
    plex: () => api,
    audioLink: (itemId, userId, start) => `https://yt.example.com/alexa/movie-audio/${itemId}?u=${userId}${start ? `&t=${start}` : ""}`,
    posterLink: (itemId) => `https://yt.example.com/alexa/movie-poster/${itemId}?s=x`,
    now: () => clock.now,
  });
  return { ...skill, handle: (userId: number, envelope: AlexaEnvelope) => skill.handle(userId, envelope) as Promise<{ response: Record<string, any> }> };
}

const intent = (name: string, slots: Record<string, string> = {}, player?: { token: string; offsetInMilliseconds: number }): AlexaEnvelope => ({
  context: { System: { device: { deviceId: "echo-1" } }, ...(player ? { AudioPlayer: player } : {}) },
  request: { type: "IntentRequest", intent: { name, slots: Object.fromEntries(Object.entries(slots).map(([key, value]) => [key, { value }])) } },
});
const event = (type: string, token: string, offsetInMilliseconds: number): AlexaEnvelope => ({
  context: { System: { device: { deviceId: "echo-1" } } },
  request: { type, token, offsetInMilliseconds },
});
const playOf = (response: { response: Record<string, any> }) => response.response.directives?.find((directive: any) => directive.type === "AudioPlayer.Play");

describe("helpers", () => {
  test("tokens carry only the Plex item", () => {
    expect(encodeMovieToken("101")).toBe("pm1.101");
    expect(decodeMovieToken("pm1.101~5")).toBe("101");
    expect(decodeMovieToken("hb1.x.0")).toBeNull();
    expect(decodeMovieToken("pm1.abc")).toBeNull();
  });

  test("a title resumes from its place unless watched, barely begun or in the credits", () => {
    expect(movieResumePosition(HEAT)).toBe(3_600);
    expect(movieResumePosition({ ...HEAT, watched: true })).toBe(0);
    expect(movieResumePosition({ ...HEAT, viewOffset: 10 })).toBe(0);
    expect(movieResumePosition({ ...HEAT, viewOffset: watchedFrom(HEAT.duration) + 1 })).toBe(0);
    expect(watchedFrom(1_300)).toBe(1_180);
    expect(watchedFrom(10_200)).toBe(9_690);
  });

  test("next up is the episode in progress, else the one after the latest watched", () => {
    const watched = (id: string, s: number, e: number) => episode(id, s, e, { watched: true });
    expect(nextUp([watched("1", 1, 1), watched("2", 1, 2), episode("3", 1, 3), episode("4", 1, 4)])?.id).toBe("3");
    expect(nextUp([watched("1", 1, 1), episode("2", 1, 2), episode("3", 1, 3, { viewOffset: 300, lastViewedAt: 5 })])?.id).toBe("3");
    // A rewatch of season 1 doesn't send you back to a skipped episode.
    expect(nextUp([episode("1", 1, 1), watched("2", 1, 2), episode("3", 1, 3)])?.id).toBe("3");
    expect(nextUp([watched("1", 1, 1)])?.id).toBe("1");
  });

  test("a season and episode spoken in one phrase", () => {
    expect(parseEpisodeRequest("the office season 2 episode 4")).toEqual({ show: "the office", season: 2, episode: 4 });
    expect(parseEpisodeRequest("The Office, season two, episode twenty one")).toEqual({ show: "The Office", season: 2, episode: 21 });
    expect(parseEpisodeRequest("the office season 3")).toEqual({ show: "the office", season: 3, episode: null });
    expect(parseEpisodeRequest("the office s2e4")).toEqual({ show: "the office", season: 2, episode: 4 });
    expect(parseEpisodeRequest("heat")).toBeNull();
    expect(parseEpisodeRequest("season of the witch")).toBeNull();
  });
});

describe("playing", () => {
  test("a movie plays from its saved place, the stream starting there, with its poster", async () => {
    const { api, saved } = fakePlex();
    const response = await skillWith(api).handle(1, intent("PlayTitleIntent", { query: "heat" }));
    const play = playOf(response);
    expect(response.response.outputSpeech.text).toBe("Resuming Heat.");
    expect(play.audioItem.stream).toMatchObject({ url: "https://yt.example.com/alexa/movie-audio/101?u=1&t=3600", token: "pm1.101", offsetInMilliseconds: 3_600_000 });
    expect(play.audioItem.metadata).toMatchObject({ title: "Heat", subtitle: "1995", art: { sources: [{ url: "https://yt.example.com/alexa/movie-poster/101?s=x" }] } });
    expect(saved).toEqual([{ id: "101", seconds: 3_600, state: "paused" }]);
  });

  test("a show carries on with its next episode", async () => {
    const { api } = fakePlex();
    const response = await skillWith(api).handle(1, intent("PlayTitleIntent", { query: "the office" }));
    expect(response.response.outputSpeech.text).toBe("Playing The Office, season 2, episode 1: Episode 1.");
    expect(playOf(response).audioItem.stream.token).toBe("pm1.203");
    const next = await skillWith(api).handle(1, intent("PlayTitleIntent", { query: "the next episode of the office" }));
    expect(playOf(next).audioItem.stream.token).toBe("pm1.203");
    const continued = await skillWith(api).handle(1, intent("ContinueShowIntent", { query: "the office" }));
    expect(playOf(continued).audioItem.stream.token).toBe("pm1.203");
  });

  test("a named episode, or a season's first", async () => {
    const { api } = fakePlex();
    expect(playOf(await skillWith(api).handle(1, intent("PlayTitleIntent", { query: "the office season 2 episode 2" }))).audioItem.stream.token).toBe("pm1.204");
    expect(playOf(await skillWith(api).handle(1, intent("PlayTitleIntent", { query: "the office season 1" }))).audioItem.stream.token).toBe("pm1.201");
    const missing = await skillWith(api).handle(1, intent("PlayTitleIntent", { query: "the office season 9 episode 1" }));
    expect(missing.response.outputSpeech.text).toBe("I couldn't find season 9, episode 1 of The Office.");
  });

  test("continue watching plays what Plex has on deck", async () => {
    const { api } = fakePlex();
    expect(playOf(await skillWith(api).handle(1, intent("ResumeWatchingIntent"))).audioItem.stream.token).toBe("pm1.101");
    const { api: empty } = fakePlex({ deck: [] });
    expect((await skillWith(empty).handle(1, intent("ResumeWatchingIntent"))).response.outputSpeech.text).toContain("You don't have anything in progress");
  });

  test("says so when Plex isn't set up", async () => {
    const skill = createAlexaMovieSkill({ plex: () => ({ disabled: "YTZERO_PLEX_URL is not set" }), audioLink: () => "", posterLink: () => "" });
    const response = await skill.handle(1, intent("ResumeWatchingIntent")) as { response: Record<string, any> };
    expect(response.response.outputSpeech.text).toBe("Hoban Movies isn't connected to Plex yet.");
  });
});

describe("while playing", () => {
  test("next and previous move by chapter in a movie", async () => {
    const { api } = fakePlex();
    const skill = skillWith(api);
    const next = await skill.handle(1, intent("AMAZON.NextIntent", {}, { token: "pm1.101", offsetInMilliseconds: 700_000 }));
    expect(playOf(next).audioItem.stream.offsetInMilliseconds).toBe(1_800_000);
    const back = await skill.handle(1, intent("AMAZON.PreviousIntent", {}, { token: "pm1.101", offsetInMilliseconds: 605_000 }));
    expect(playOf(back).audioItem.stream.offsetInMilliseconds).toBe(0);
    const restart = await skill.handle(1, intent("AMAZON.PreviousIntent", {}, { token: "pm1.101", offsetInMilliseconds: 700_000 }));
    expect(playOf(restart).audioItem.stream.offsetInMilliseconds).toBe(600_000);
  });

  test("next moves to the next episode in a show, saving the one left", async () => {
    const { api, saved } = fakePlex();
    const response = await skillWith(api).handle(1, intent("AMAZON.NextIntent", {}, { token: "pm1.203", offsetInMilliseconds: 400_000 }));
    expect(playOf(response).audioItem.stream.token).toBe("pm1.204");
    expect(saved[0]).toEqual({ id: "203", seconds: 400, state: "stopped" });
  });

  test("skips and jumps within the title", async () => {
    const { api } = fakePlex();
    const skill = skillWith(api);
    const back = await skill.handle(1, intent("SkipBackIntent", { duration: "PT30S" }, { token: "pm1.101", offsetInMilliseconds: 100_000 }));
    expect(playOf(back).audioItem.stream.offsetInMilliseconds).toBe(70_000);
    const jump = await skill.handle(1, intent("SeekToIntent", { position: "PT1H10M" }, { token: "pm1.101", offsetInMilliseconds: 100_000 }));
    expect(playOf(jump).audioItem.stream.offsetInMilliseconds).toBe(4_200_000);
  });

  test("what's playing and how much is left", async () => {
    const { api } = fakePlex();
    const skill = skillWith(api);
    expect((await skill.handle(1, intent("WhatIsPlayingIntent", {}, { token: "pm1.101", offsetInMilliseconds: 0 }))).response.outputSpeech.text).toBe("This is Heat, from 1995.");
    expect((await skill.handle(1, intent("TimeLeftIntent", {}, { token: "pm1.203", offsetInMilliseconds: 700_000 }))).response.outputSpeech.text).toBe("There's 10 minutes left in this episode.");
  });
});

describe("events", () => {
  test("a stop saves the place, a finish marks it watched", async () => {
    const { api, saved, watched } = fakePlex();
    const clock = { now: 1_000_000 };
    const skill = skillWith(api, clock);
    await skill.handle(1, event("AudioPlayer.PlaybackStopped", "pm1.101", 4_000_000));
    expect(saved).toEqual([{ id: "101", seconds: 4_000, state: "stopped" }]);
    await skill.handle(1, event("AudioPlayer.PlaybackFinished", "pm1.101", 10_200_000));
    expect(watched).toEqual(["101"]);
  });

  test("a stop in the credits marks it watched", async () => {
    const { api, saved, watched } = fakePlex();
    await skillWith(api).handle(1, event("AudioPlayer.PlaybackStopped", "pm1.101", 9_900_000));
    expect(saved).toEqual([]);
    expect(watched).toEqual(["101"]);
  });

  test("the old stream's stop right after a new play doesn't overwrite the new place", async () => {
    const { api, saved } = fakePlex();
    const clock = { now: 1_000_000 };
    const skill = skillWith(api, clock);
    await skill.handle(1, intent("SkipForwardIntent", { duration: "PT1M" }, { token: "pm1.101", offsetInMilliseconds: 100_000 }));
    clock.now += 2_000;
    await skill.handle(1, event("AudioPlayer.PlaybackStopped", "pm1.101", 101_000));
    expect(saved).toEqual([{ id: "101", seconds: 160, state: "paused" }]);
  });

  test("an episode nearly finished queues the next one from its start", async () => {
    const { api } = fakePlex();
    const response = await skillWith(api).handle(1, event("AudioPlayer.PlaybackNearlyFinished", "pm1.203", 1_290_000));
    const play = playOf(response);
    expect(play).toMatchObject({ playBehavior: "ENQUEUE", audioItem: { stream: { token: "pm1.204", offsetInMilliseconds: 0, expectedPreviousToken: "pm1.203" } } });
    expect(playOf(await skillWith(api).handle(1, event("AudioPlayer.PlaybackNearlyFinished", "pm1.101", 10_190_000)))).toBeUndefined();
  });
});
