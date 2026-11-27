import { log } from "../logger";
import { upsertMusicTracks } from "../music/musicCatalog";
import { recordMusicEchoPlay, type MusicEchoPlay } from "../music/musicEchoPlays";
import { recordMusicPlay, type MusicPlay, type MusicPlayEndReason } from "../music/musicPlays";
import { songKey } from "../music/musicSongKey";
import { createYouTubeMusicClient } from "../music/youtubeMusicClient";
import { alexaConfig, resolveAlexaProfile } from "./alexaConfig";
import { createEchoMatcher, type EchoMatcher } from "./alexaEchoMatch";
import { createAlexaRoomStore, type AlexaRoomStore } from "./alexaRooms";
import { createAlexaRoomSettings, type AlexaRoomSettings } from "./alexaRoomSettings";
import {
  createHomeAssistantClient, homeAssistantConfig, homeAssistantReport, homeAssistantSeesMedia,
  type HomeAssistantClient, type HomeAssistantReport,
} from "./homeAssistant";

/**
 * Listening history from the household's Echoes: songs they play through
 * another service, such as Amazon Music, which Home Assistant can see. Each
 * song heard is matched to a YouTube Music track and recorded as an ordinary
 * play of the Alexa profile; one with no match is kept apart and shown greyed
 * out in Recently played. Our own skills' audio is recorded by the skills.
 */
export const ECHO_POLL_MS = 15_000;
/** Shorter than this, or longer, it isn't a song: a jingle, or a podcast episode or audiobook chapter. */
export const ECHO_MIN_SONG_MS = 30_000;
export const ECHO_MAX_SONG_MS = 15 * 60_000;
/** A song heard for less than this isn't recorded. */
export const ECHO_MIN_HEARD_MS = 10_000;
/** A gap between polls longer than this (a missed poll, a paused server) counts as this much. */
const MAX_GAP_MS = 2 * ECHO_POLL_MS;

type Report = Pick<HomeAssistantReport, "state" | "title" | "artist" | "album" | "art" | "durationMs" | "positionMs">;

/**
 * Whether what an Echo reports looks like a song. Home Assistant calls
 * everything "music", podcasts and audiobooks included, so this goes by
 * length and by how Audible names a book ("By <author>", "Narrated by …").
 */
export function isEchoSong(report: Report): boolean {
  if (!report.title || !report.artist) return false;
  if (report.durationMs == null || report.durationMs < ECHO_MIN_SONG_MS || report.durationMs > ECHO_MAX_SONG_MS) return false;
  if (/^by\s/i.test(report.artist) || /^narrated by\s/i.test(report.album ?? "")) return false;
  return songKey(report.artist, report.title) !== "|";
}

export interface HeardEchoSong {
  entity: string;
  title: string;
  artist: string;
  album: string | null;
  art: string | null;
  durationMs: number;
  startedAt: Date;
  listenedSeconds: number;
  endReason: MusicPlayEndReason;
}

interface Listening {
  key: string; title: string; artist: string; album: string | null; art: string | null; durationMs: number;
  startedAt: number; heardMs: number; positionMs: number; playing: boolean; at: number;
}

const keyOf = (report: Report) => `${report.title}\n${report.artist}`;

/**
 * Follows what each Echo plays, poll by poll, and says which songs ended: how
 * long each was heard, and whether it ran to the end. A song is told apart from
 * the next by its title and artist.
 */
export function createEchoListeningTracker() {
  const active = new Map<string, Listening>();

  function start(report: Report, now: number): Listening {
    const positionMs = Math.max(0, report.positionMs ?? 0);
    return {
      key: keyOf(report), title: report.title!, artist: report.artist!, album: report.album, art: report.art, durationMs: report.durationMs!,
      startedAt: now - Math.min(positionMs, report.durationMs!), heardMs: 0, positionMs, playing: report.state === "playing", at: now,
    };
  }

  /** Ends a song. `nextStarted` says another song replaced it; otherwise nothing is playing. */
  function finish(entity: string, song: Listening, now: number, nextStarted: boolean, finalPositionMs: number | null): HeardEchoSong | null {
    const gap = Math.min(Math.max(0, now - song.at), MAX_GAP_MS);
    const remaining = Math.max(0, song.durationMs - song.positionMs);
    let heardMs = song.heardMs;
    let completed: boolean;
    if (finalPositionMs != null) {
      // Home Assistant still shows the finished song, with where it stopped.
      if (song.playing) heardMs += Math.min(gap, Math.max(0, finalPositionMs - song.positionMs));
      completed = song.durationMs - finalPositionMs <= 5_000;
    } else if (song.playing && remaining <= gap) {
      // It would have run out before now anyway.
      heardMs += remaining;
      completed = true;
    } else {
      // It ended somewhere since the last poll: count half of that.
      if (song.playing) heardMs += Math.min(remaining, gap / 2);
      completed = false;
    }
    if (!completed && heardMs < ECHO_MIN_HEARD_MS) return null;
    return {
      entity, title: song.title, artist: song.artist, album: song.album, art: song.art, durationMs: song.durationMs,
      startedAt: new Date(song.startedAt), listenedSeconds: Math.round(Math.min(heardMs, song.durationMs) / 1000),
      endReason: completed ? "completed" : nextStarted ? "skipped" : "stopped",
    };
  }

  return {
    /** One poll of one Echo: its report, or null when Home Assistant has nothing for it. Returns the songs that ended. */
    observe(entity: string, report: Report | null, now: number): HeardEchoSong[] {
      const ended: HeardEchoSong[] = [];
      const current = active.get(entity) ?? null;
      const song = report && homeAssistantSeesMedia(report) && isEchoSong(report) ? report : null;
      if (current && song && keyOf(song) === current.key) {
        const positionMs = Math.max(0, song.positionMs ?? current.positionMs);
        const gap = Math.min(Math.max(0, now - current.at), MAX_GAP_MS);
        // Back near the start after reaching the end: the same song again, on repeat.
        if (current.playing && current.durationMs - current.positionMs <= gap && positionMs + 5_000 < current.positionMs) {
          const repeated = finish(entity, current, now, true, null);
          if (repeated) ended.push(repeated);
          active.set(entity, start(song, now));
          return ended;
        }
        if (current.playing) current.heardMs += gap;
        Object.assign(current, { positionMs, playing: song.state === "playing", at: now, art: song.art ?? current.art });
        return ended;
      }
      if (current) {
        // An idle Echo still reports the song it finished, with its final position.
        const leftover = !song && report && report.title && keyOf(report) === current.key && report.positionMs != null ? report.positionMs : null;
        const done = finish(entity, current, now, Boolean(song), leftover);
        if (done) ended.push(done);
        active.delete(entity);
      }
      if (song) active.set(entity, start(song, now));
      return ended;
    },

    /** Forgets an Echo no longer watched, without recording what it was playing. */
    forget(entity: string) { active.delete(entity); },
    watching: () => [...active.keys()],
  };
}

export interface EchoListeningDependencies {
  homeAssistant: Pick<HomeAssistantClient, "mediaPlayers">;
  /** The profile the Alexa skills play as, which the wall tablet signs in as. */
  userId: () => Promise<number | null>;
  settings: Pick<AlexaRoomSettings, "entities">;
  rooms: Pick<AlexaRoomStore, "devices">;
  matcher: EchoMatcher;
  recordPlay: (userId: number, play: MusicPlay) => Promise<void>;
  recordEchoPlay: (userId: number, play: MusicEchoPlay) => Promise<void>;
}

/** One pass over every room with a Home Assistant entity: a single GET /api/states. */
export function createEchoListening(dependencies: EchoListeningDependencies) {
  const tracker = createEchoListeningTracker();
  let lastError: string | null = null;

  /** Whether one of our skills played this song in the room: the skill already recorded it. */
  async function ours(userId: number, room: string, heard: HeardEchoSong): Promise<boolean> {
    const devices = await dependencies.rooms.devices(userId);
    return devices.some((device) => device.room?.toLowerCase() === room.toLowerCase() && device.nowPlaying
      && device.nowPlaying.title.toLowerCase() === heard.title.toLowerCase() && device.nowPlaying.updatedAt >= heard.startedAt.toISOString());
  }

  async function record(userId: number, room: string, heard: HeardEchoSong): Promise<void> {
    if (await ours(userId, room, heard)) return;
    const match = await dependencies.matcher.match(userId, heard);
    const fields = { room, title: heard.title, artist: heard.artist, endReason: heard.endReason, listenedSeconds: heard.listenedSeconds };
    const duration = Math.round(heard.durationMs / 1000);
    if (match.videoId !== null) {
      await dependencies.recordPlay(userId, { videoId: match.videoId, startedAt: heard.startedAt, listenedSeconds: heard.listenedSeconds, duration, endReason: heard.endReason, stationSeed: null });
      log.info("alexa.echo_play_matched", { ...fields, videoId: match.videoId, via: match.via });
      return;
    }
    await dependencies.recordEchoPlay(userId, {
      songKey: songKey(heard.artist, heard.title), title: heard.title, artist: heard.artist, album: heard.album, art: heard.art ?? "",
      startedAt: heard.startedAt, listenedSeconds: heard.listenedSeconds, duration, endReason: heard.endReason,
    });
    log.info("alexa.echo_play_unmatched", { ...fields, reason: match.reason, ...(match.error ? { error: match.error } : {}) });
  }

  return {
    tracker,
    async tick(now = Date.now()): Promise<void> {
      const userId = await dependencies.userId();
      const entities = userId == null ? new Map() : await dependencies.settings.entities(userId);
      const rooms = new Map([...entities.values()].map(({ room, entity }) => [entity, room as string]));
      for (const entity of tracker.watching()) if (!rooms.has(entity)) tracker.forget(entity);
      if (userId == null || !rooms.size) return;
      let states;
      try {
        states = await dependencies.homeAssistant.mediaPlayers();
        if (lastError) log.info("alexa.echo_listening_resumed", {});
        lastError = null;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastError) log.warn("alexa.echo_listening_failed", { error: message });
        lastError = message;
        return;
      }
      const byEntity = new Map(states.map((state) => [state.entity_id, state]));
      for (const [entity, room] of rooms) {
        const state = byEntity.get(entity);
        for (const heard of tracker.observe(entity, state ? homeAssistantReport(state, now) : null, now)) {
          await record(userId, room, heard).catch((error) =>
            log.warn("alexa.echo_play_failed", { room, title: heard.title, error: error instanceof Error ? error.message : String(error) }));
        }
      }
    },
  };
}

/**
 * Starts the watcher when both the Alexa skills and Home Assistant are
 * configured. It asks Home Assistant nothing until a room has an entity.
 */
export function startAlexaEchoListening(): void {
  const alexa = alexaConfig();
  const homeAssistant = homeAssistantConfig();
  if ("disabled" in alexa || "disabled" in homeAssistant) return;
  const client = createYouTubeMusicClient();
  const listening = createEchoListening({
    homeAssistant: createHomeAssistantClient(homeAssistant),
    userId: () => resolveAlexaProfile(alexa.profile),
    settings: createAlexaRoomSettings(),
    rooms: createAlexaRoomStore(),
    matcher: createEchoMatcher({ search: client.searchSongs, remember: upsertMusicTracks }),
    recordPlay: recordMusicPlay,
    recordEchoPlay: (userId, play) => recordMusicEchoPlay(userId, play),
  });
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    listening.tick()
      .catch((error) => log.warn("alexa.echo_listening_failed", { error: error instanceof Error ? error.message : String(error) }))
      .finally(() => { running = false; });
  }, ECHO_POLL_MS);
  timer.unref?.();
  log.info("alexa.echo_listening_started", { intervalSeconds: ECHO_POLL_MS / 1000 });
}
