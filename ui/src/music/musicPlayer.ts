import { useSyncExternalStore } from "react";
import { img } from "../img";
import { isIncognitoMode } from "../incognitoMode";
import { musicApi, type MusicSeed, type MusicTrack } from "./musicApi";
import {
  appendTracks, createQueue, current, endReason, moveTo, needsMore, playRecord, rateTrack, removeUpcoming, served, shuffleTracks,
  type MusicQueue,
} from "./musicQueue";

export type MusicPlayerState = {
  queue: MusicQueue | null;
  playing: boolean;
  /** A station is being fetched or the song's audio is loading. */
  loading: boolean;
  position: number;
  duration: number;
  error: boolean;
};

const MAX_FAILURES = 3;

const IDLE: MusicPlayerState = { queue: null, playing: false, loading: false, position: 0, duration: 0, error: false };

/**
 * The web player's music mode: one audio element for the whole page, so a
 * station keeps playing while the listener browses elsewhere in YT Zero. It
 * records listens and skips the way the phone does, so stations learn from both.
 */
class WebMusicPlayer {
  private state: MusicPlayerState = IDLE;
  private readonly listeners = new Set<() => void>();
  private audio: HTMLAudioElement | null = null;
  private listen: { videoId: string; startedAt: Date; listened: number; last: number | null } | null = null;
  private refilling = false;
  private generation = 0;
  /** Songs in a row that wouldn't play; past a few, the server or network is down, so stop. */
  private failures = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  snapshot = () => this.state;

  private set(next: Partial<MusicPlayerState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  private element(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const audio = new Audio();
    audio.preload = "auto";
    audio.addEventListener("timeupdate", () => {
      this.countListening(audio.currentTime);
      this.set({ position: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : this.state.duration });
    });
    audio.addEventListener("playing", () => { this.failures = 0; this.set({ playing: true, loading: false, error: false }); });
    audio.addEventListener("pause", () => { this.listenPaused(); this.set({ playing: false }); });
    audio.addEventListener("waiting", () => this.set({ loading: true }));
    audio.addEventListener("ended", () => void this.advance(false));
    audio.addEventListener("error", () => {
      if (!audio.src) return;
      this.set({ error: true, loading: false });
      this.failures += 1;
      if (this.failures >= MAX_FAILURES) { this.finishListen(false, false); this.set({ playing: false }); return; }
      // A song YouTube won't serve shouldn't end the station.
      void this.advance(false, true);
    });
    this.audio = audio;
    this.bindMediaSession();
    return audio;
  }

  private countListening(time: number) {
    if (!this.listen) return;
    if (this.listen.last !== null && time > this.listen.last && time - this.listen.last < 5) this.listen.listened += time - this.listen.last;
    this.listen.last = time;
  }

  private listenPaused() {
    if (this.listen) this.listen.last = null;
  }

  /** Records the listen to the song now ending, if any. */
  private finishListen(finished: boolean, skipped: boolean) {
    const queue = this.state.queue;
    const track = current(queue);
    const listen = this.listen;
    this.listen = null;
    if (!queue || !track || !listen || listen.videoId !== track.videoId || listen.listened < 1) return;
    // Incognito mode in this tab: the listen isn't recorded, so it doesn't shape the mix or stations. Ratings still are.
    if (isIncognitoMode()) return;
    const reason = endReason(listen.listened, track.duration, finished, skipped);
    void musicApi.recordPlay(playRecord(queue, track, listen.startedAt, listen.listened, reason)).catch(() => {});
  }

  private load(track: MusicTrack, autoplay = true) {
    const audio = this.element();
    this.listen = { videoId: track.videoId, startedAt: new Date(), listened: 0, last: null };
    audio.src = musicApi.audioUrl(track.videoId);
    this.set({ position: 0, duration: track.duration ?? 0, loading: true, error: false });
    this.updateMediaSession(track);
    if (autoplay) void audio.play().catch(() => this.set({ playing: false, loading: false }));
    void this.refill();
  }

  /** Starts a station, album or playlist. `from` names the album or playlist while its own songs play. */
  async start(seed: MusicSeed, options: { shuffle?: boolean; from?: string } = {}) {
    const generation = ++this.generation;
    this.failures = 0;
    this.finishListen(false, false);
    this.audio?.pause();
    this.set({ loading: true, error: false });
    try {
      const station = await musicApi.station(seed, [], [], seed.kind === "album" ? 200 : 10);
      if (generation !== this.generation) return;
      const tracks = options.shuffle ? shuffleTracks(station.tracks) : station.tracks;
      if (!tracks.length) { this.set({ loading: false, error: true }); return; }
      const fromLabel = seed.kind === "album" || seed.kind === "playlist" ? options.from ?? null : null;
      this.set({ queue: createQueue(seed, station.seed, tracks, fromLabel) });
      this.load(tracks[0]);
    } catch {
      if (generation === this.generation) this.set({ loading: false, error: true });
    }
  }

  /**
   * Plays a list of songs the server already gave, such as one of the profile's
   * own playlists, from `startAt`; a station from its first song follows.
   */
  playTracks(tracks: MusicTrack[], options: { from: string; shuffle?: boolean; startAt?: string }) {
    if (!tracks.length) return;
    this.generation++;
    this.failures = 0;
    this.finishListen(false, false);
    this.audio?.pause();
    const ordered = options.shuffle ? shuffleTracks(tracks) : tracks;
    const start = options.startAt ? Math.max(0, ordered.findIndex((track) => track.videoId === options.startAt)) : 0;
    const list = ordered.slice(start);
    this.set({ queue: createQueue({ kind: "track", videoId: list[0].videoId }, null, list, options.from) });
    this.load(list[0]);
  }

  private async refill() {
    const queue = this.state.queue;
    if (!queue || !needsMore(queue) || this.refilling) return;
    this.refilling = true;
    const generation = this.generation;
    try {
      const more = await musicApi.station(queue.seed, served(queue), queue.skipped, 10);
      if (generation !== this.generation || !this.state.queue) return;
      this.set({ queue: appendTracks(this.state.queue, more.tracks) });
    } catch {
      // The next song change tries again.
    } finally { this.refilling = false; }
  }

  private async advance(skipped: boolean, failed = false) {
    const queue = this.state.queue;
    if (!queue) return;
    this.finishListen(!skipped && !failed, skipped);
    if (queue.index + 1 >= queue.tracks.length) await this.refill();
    const latest = this.state.queue;
    if (!latest || latest.index + 1 >= latest.tracks.length) { this.set({ playing: false, loading: false }); return; }
    const next = moveTo(latest, latest.index + 1, skipped);
    this.set({ queue: next });
    this.load(current(next)!);
  }

  toggle() {
    const audio = this.audio;
    if (!audio || !this.state.queue) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  }

  next() { void this.advance(true); }

  /** Back to the start of the song, or the song before when it has barely begun. */
  previous() {
    const audio = this.audio;
    const queue = this.state.queue;
    if (!audio || !queue) return;
    if (audio.currentTime > 3 || queue.index === 0) { audio.currentTime = 0; return; }
    this.finishListen(false, true);
    const back = moveTo(queue, queue.index - 1, false);
    this.set({ queue: back });
    this.load(current(back)!);
  }

  /** Plays a song already in the queue. */
  jumpTo(index: number) {
    const queue = this.state.queue;
    if (!queue || index === queue.index || !queue.tracks[index]) return;
    this.finishListen(false, true);
    const moved = moveTo(queue, index, true);
    this.set({ queue: moved });
    this.load(current(moved)!);
  }

  seek(seconds: number) {
    if (this.audio) this.audio.currentTime = Math.max(0, seconds);
  }

  stop() {
    this.generation++;
    this.finishListen(false, false);
    if (this.audio) { this.audio.pause(); this.audio.removeAttribute("src"); this.audio.load(); }
    this.set(IDLE);
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
  }

  async rate(track: MusicTrack, rating: 1 | 0 | -1) {
    const value = rating === 0 ? null : rating;
    if (this.state.queue) this.set({ queue: rateTrack(this.state.queue, track.videoId, value) });
    await musicApi.rate(track.videoId, rating);
  }

  /** "Not this one": never again, and skip it now if it's playing. */
  async dislike(track: MusicTrack) {
    const queue = this.state.queue;
    if (queue) this.set({ queue: removeUpcoming(rateTrack(queue, track.videoId, -1), track.videoId) });
    if (current(this.state.queue)?.videoId === track.videoId) this.next();
    await musicApi.rate(track.videoId, -1);
  }

  private bindMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => this.toggle()], ["pause", () => this.toggle()], ["nexttrack", () => this.next()], ["previoustrack", () => this.previous()],
      ["seekto", (details) => { if (details.seekTime != null) this.seek(details.seekTime); }],
    ];
    for (const [action, handler] of handlers) {
      try { session.setActionHandler(action, handler); } catch { /* an action this browser doesn't support */ }
    }
  }

  private updateMediaSession(track: MusicTrack) {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    const artwork = track.thumbnail ? [{ src: img(track.thumbnail), sizes: "544x544" }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album ?? "", artwork });
  }
}

export const musicPlayer = new WebMusicPlayer();

export function useMusicPlayer(): MusicPlayerState {
  return useSyncExternalStore(musicPlayer.subscribe, musicPlayer.snapshot, musicPlayer.snapshot);
}
