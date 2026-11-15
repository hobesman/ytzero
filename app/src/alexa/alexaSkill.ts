import { log } from "../logger";
import { musicTrack, upsertMusicTracks, type StoredMusicTrack } from "../music/musicCatalog";
import type { MusicPlay } from "../music/musicPlays";
import { stationSeedKey, type MusicStations, type StationSeed } from "../music/musicStation";
import type { MusicPlaylist, YouTubeMusicClient } from "../music/youtubeMusicClient";
import {
  advancedState, decodePlaybackToken, encodePlaybackToken, playDirective, playResponse, silent, speak, stopDirective,
  type AlexaPlaybackState, type AlexaResponse,
} from "./alexaPlayback";

/** The parts of an Alexa request envelope the skill reads. */
export interface AlexaEnvelope {
  context?: {
    System?: { application?: { applicationId?: string } };
    AudioPlayer?: { token?: string; offsetInMilliseconds?: number; playerActivity?: string };
  };
  session?: { application?: { applicationId?: string } };
  request?: {
    type?: string;
    timestamp?: string;
    token?: string;
    offsetInMilliseconds?: number;
    intent?: { name?: string; slots?: Record<string, { value?: string }> };
    error?: { type?: string; message?: string };
  };
}

export function envelopeSkillId(envelope: AlexaEnvelope): string | undefined {
  return envelope.context?.System?.application?.applicationId ?? envelope.session?.application?.applicationId;
}

export interface AlexaSkillDependencies {
  client: Pick<YouTubeMusicClient, "searchSongs" | "searchAll">;
  stations: Pick<MusicStations, "next">;
  /** Starts fetching a song's audio before Alexa asks for it. */
  prepare: (userId: number, videoId: string) => void;
  audioLink: (videoId: string, userId: number) => string;
  recordPlay: (userId: number, play: MusicPlay) => Promise<void>;
  findTrack?: (videoId: string) => Promise<StoredMusicTrack | null>;
  saveTracks?: typeof upsertMusicTracks;
  /** The YouTube Music playlist for a spoken genre, mood or decade, such as "80s" or "the latest pop". */
  findGenre?: (userId: number, spoken: string) => Promise<MusicPlaylist | null>;
}

const MAX_FAILURES_IN_A_ROW = 3;
const LISTEN_LIMIT = 256;
const HELP = "You can say play a song, play songs by an artist, play the album, play eighties music, play my liked songs, or play my mix.";
const ASK = "What would you like to hear?";
const UNREACHABLE = "Sorry, I couldn't reach YouTube Music right now. Please try again in a moment.";

const SEED_INTENTS = new Set(["PlaySongIntent", "PlayArtistIntent", "PlayAlbumIntent", "PlayLikedIntent", "PlayMixIntent", "PlayGenreIntent"]);
const STOP_INTENTS = new Set(["AMAZON.PauseIntent", "AMAZON.StopIntent", "AMAZON.CancelIntent"]);
const UNSUPPORTED_INTENTS = new Set([
  "AMAZON.PreviousIntent", "AMAZON.LoopOnIntent", "AMAZON.LoopOffIntent", "AMAZON.ShuffleOnIntent",
  "AMAZON.ShuffleOffIntent", "AMAZON.RepeatIntent",
]);

export function createAlexaSkill(dependencies: AlexaSkillDependencies) {
  const findTrack = dependencies.findTrack ?? musicTrack;
  const saveTracks = dependencies.saveTracks ?? upsertMusicTracks;
  // When each stream token began playing, so a pause and resume stay one listen.
  const listens = new Map<string, { startedAt: Date; skipped: boolean }>();

  function remember(token: string, startedAt: Date) {
    if (listens.has(token)) return;
    listens.set(token, { startedAt, skipped: false });
    while (listens.size > LISTEN_LIMIT) listens.delete(listens.keys().next().value!);
  }

  async function play(userId: number, state: AlexaPlaybackState, track: StoredMusicTrack, behavior: "REPLACE_ALL" | "ENQUEUE", extra: { speech?: string | null; offset?: number; previousToken?: string } = {}) {
    dependencies.prepare(userId, track.videoId);
    const directive = playDirective({
      track,
      url: dependencies.audioLink(track.videoId, userId),
      token: encodePlaybackToken(state),
      behavior,
      offsetInMilliseconds: extra.offset,
      expectedPreviousToken: extra.previousToken,
    });
    return extra.speech === undefined ? silent([directive]) : playResponse(extra.speech, directive);
  }

  /** The song after the current one: the album's next track, else the station's pick. */
  async function nextTrack(userId: number, state: AlexaPlaybackState, skippingCurrent: boolean): Promise<StoredMusicTrack | null> {
    const served = [...state.served, state.videoId];
    if (state.seed.kind === "album") {
      const album = await dependencies.stations.next(userId, state.seed, [], [], 1);
      const index = album.findIndex((track) => track.videoId === state.videoId);
      const following = index >= 0 ? album[index + 1] : undefined;
      if (following && !served.includes(following.videoId)) return following;
    }
    const skipped = skippingCurrent ? [...state.skipped, state.videoId] : state.skipped;
    const [track] = await dependencies.stations.next(userId, state.seed, served, skipped, 1);
    return track ?? null;
  }

  async function seedFor(userId: number, intent: string, query: string): Promise<{ seed: StationSeed; intro: (track: StoredMusicTrack) => string } | string> {
    if (intent === "PlayLikedIntent") return { seed: { kind: "liked" }, intro: () => "Playing your liked songs." };
    if (intent === "PlayMixIntent") return { seed: { kind: "mix" }, intro: () => "Playing your mix." };
    if (!query) return "What should I play?";
    if (intent === "PlayGenreIntent") {
      const playlist = await dependencies.findGenre?.(userId, query);
      if (!playlist) return `I couldn't find a playlist for ${query}.`;
      return { seed: { kind: "playlist", playlistId: playlist.playlistId }, intro: () => `Playing ${playlist.title}.` };
    }
    if (intent === "PlaySongIntent") {
      const [song] = await saveTracks(await dependencies.client.searchSongs(userId, query));
      if (!song) return `I couldn't find a song called ${query}.`;
      return { seed: { kind: "track", videoId: song.videoId }, intro: (track) => `Playing ${track.title} by ${track.artist}.` };
    }
    const shelves = await dependencies.client.searchAll(userId, query);
    if (intent === "PlayArtistIntent") {
      const [artist] = shelves.artists;
      if (!artist) return `I couldn't find an artist called ${query}.`;
      return { seed: { kind: "artist", artistId: artist.channelId }, intro: () => `Playing songs by ${artist.name}.` };
    }
    const [album] = shelves.albums;
    if (!album) return `I couldn't find an album called ${query}.`;
    return { seed: { kind: "album", browseId: album.browseId }, intro: () => `Playing ${album.title} by ${album.artist}.` };
  }

  async function startStation(userId: number, intent: string, query: string): Promise<AlexaResponse> {
    const found = await seedFor(userId, intent, query);
    if (typeof found === "string") return speak(found, ASK);
    const [first] = await dependencies.stations.next(userId, found.seed, [], [], 1);
    if (!first) return speak(found.seed.kind === "liked" ? "You haven't liked any songs yet." : "I couldn't find anything to play for that.");
    const state: AlexaPlaybackState = { seed: found.seed, videoId: first.videoId, served: [], skipped: [], failures: 0 };
    return play(userId, state, first, "REPLACE_ALL", { speech: found.intro(first) });
  }

  async function resume(userId: number, envelope: AlexaEnvelope, fromStart: boolean): Promise<AlexaResponse> {
    const player = envelope.context?.AudioPlayer;
    const state = decodePlaybackToken(player?.token);
    const track = state ? await findTrack(state.videoId) : null;
    if (!state || !track) return speak(`There's nothing to resume. ${ASK}`, ASK);
    return play(userId, state, track, "REPLACE_ALL", { offset: fromStart ? 0 : player?.offsetInMilliseconds ?? 0 });
  }

  async function skip(userId: number, token: string | undefined, speech: boolean): Promise<AlexaResponse> {
    const state = decodePlaybackToken(token);
    if (!state) return speech ? speak(`Nothing is playing. ${ASK}`, ASK) : silent();
    const listen = token ? listens.get(token) : undefined;
    if (listen) listen.skipped = true;
    const track = await nextTrack(userId, state, true);
    if (!track) return speech ? speak("That's the end of this station.") : silent([stopDirective]);
    return play(userId, advancedState(state, track.videoId, true), track, "REPLACE_ALL");
  }

  async function finishListen(userId: number, envelope: AlexaEnvelope, endReason: "completed" | "stopped") {
    const token = envelope.request?.token;
    const state = decodePlaybackToken(token);
    if (!state || !token) return;
    const offset = Math.max(0, Number(envelope.request?.offsetInMilliseconds) || 0);
    const at = Date.parse(envelope.request?.timestamp ?? "") || Date.now();
    const listen = listens.get(token);
    // After a restart the start is lost; the position is the best estimate of it.
    const startedAt = listen?.startedAt ?? new Date(at - offset);
    const track = await findTrack(state.videoId);
    await dependencies.recordPlay(userId, {
      videoId: state.videoId,
      startedAt,
      listenedSeconds: Math.round(offset / 1000),
      duration: track?.duration ?? null,
      endReason: listen?.skipped ? "skipped" : endReason,
      stationSeed: stationSeedKey(state.seed),
    });
    if (endReason === "completed") listens.delete(token);
  }

  async function audioEvent(userId: number, envelope: AlexaEnvelope, type: string): Promise<AlexaResponse> {
    const token = envelope.request?.token;
    if (type === "AudioPlayer.PlaybackStarted") {
      if (token) remember(token, new Date(Date.parse(envelope.request?.timestamp ?? "") || Date.now()));
      return silent();
    }
    if (type === "AudioPlayer.PlaybackFinished") return finishListen(userId, envelope, "completed").then(() => silent());
    if (type === "AudioPlayer.PlaybackStopped") return finishListen(userId, envelope, "stopped").then(() => silent());
    if (type === "AudioPlayer.PlaybackNearlyFinished") {
      const state = decodePlaybackToken(token);
      if (!state) return silent();
      const track = await nextTrack(userId, state, false);
      if (!track) return silent();
      return play(userId, advancedState(state, track.videoId, false), track, "ENQUEUE", { previousToken: token });
    }
    if (type === "AudioPlayer.PlaybackFailed") {
      log.warn("alexa.playback_failed", { error: envelope.request?.error?.type, message: envelope.request?.error?.message });
      const state = decodePlaybackToken(token);
      if (!state || state.failures + 1 >= MAX_FAILURES_IN_A_ROW) return silent([stopDirective]);
      const track = await nextTrack(userId, state, false);
      if (!track) return silent([stopDirective]);
      return play(userId, advancedState(state, track.videoId, false, true), track, "REPLACE_ALL");
    }
    return silent();
  }

  async function controller(userId: number, envelope: AlexaEnvelope, type: string): Promise<AlexaResponse> {
    if (type === "PlaybackController.NextCommandIssued") return skip(userId, envelope.context?.AudioPlayer?.token, false);
    if (type === "PlaybackController.PauseCommandIssued") return silent([stopDirective]);
    if (type === "PlaybackController.PlayCommandIssued") {
      const response = await resume(userId, envelope, false);
      return "outputSpeech" in response.response ? silent() : response;
    }
    return silent();
  }

  async function intent(userId: number, envelope: AlexaEnvelope): Promise<AlexaResponse> {
    const name = envelope.request?.intent?.name ?? "";
    if (SEED_INTENTS.has(name)) {
      const query = envelope.request?.intent?.slots?.query?.value?.trim().slice(0, 200) ?? "";
      return startStation(userId, name, query);
    }
    if (STOP_INTENTS.has(name)) return silent([stopDirective]);
    if (name === "AMAZON.ResumeIntent") return resume(userId, envelope, false);
    if (name === "AMAZON.StartOverIntent") return resume(userId, envelope, true);
    if (name === "AMAZON.NextIntent") return skip(userId, envelope.context?.AudioPlayer?.token, true);
    if (UNSUPPORTED_INTENTS.has(name)) return speak("Sorry, YT Zero can't do that yet.");
    return speak(HELP, ASK);
  }

  async function handle(userId: number, envelope: AlexaEnvelope): Promise<AlexaResponse> {
    const type = envelope.request?.type ?? "";
    try {
      if (type === "LaunchRequest") return speak(ASK, HELP);
      if (type === "IntentRequest") return await intent(userId, envelope);
      if (type.startsWith("AudioPlayer.")) return await audioEvent(userId, envelope, type);
      if (type.startsWith("PlaybackController.")) return await controller(userId, envelope, type);
      if (type === "System.ExceptionEncountered") {
        log.warn("alexa.exception", { error: envelope.request?.error?.type, message: envelope.request?.error?.message });
      }
      return silent();
    } catch (error) {
      log.warn("alexa.request_failed", { type, error: error instanceof Error ? error.message : String(error) });
      return type === "IntentRequest" || type === "LaunchRequest" ? speak(UNREACHABLE) : silent();
    }
  }

  return { handle };
}

export type AlexaSkill = ReturnType<typeof createAlexaSkill>;
