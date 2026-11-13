import { useSyncExternalStore } from "react";
import { musicPlayer, type MusicPlayerProgress, type MusicPlayerState, type MusicTrackChange } from "../musicPlayer";
import { onSleepTimerChange, setSleepTimer, sleepTimer } from "../sleepTimer";
import type { MusicApi, MusicSeed, MusicTrack } from "./musicApi";
import {
  appendTracks, applyTrackChange, createQueue, current, endReason, needsMore, playFor, rateTrack, removeTrack, served,
  type MusicQueue,
} from "./musicQueue";

export type MusicSessionState = {
  queue: MusicQueue | null;
  player: MusicPlayerState | null;
  /** A station is being fetched. */
  starting: boolean;
  error: string | null;
};

const EMPTY: MusicSessionState = { queue: null, player: null, starting: false, error: null };

/**
 * The station playing now, shared by every music screen: it keeps the native
 * player's queue a few songs ahead, has the server ready the next song, and
 * records each song's play when it ends.
 */
export class MusicSession {
  private state: MusicSessionState = EMPTY;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: (() => void)[] = [];
  private refilling = false;
  private generation = 0;

  constructor(private readonly api: MusicApi) {
    void musicPlayer.setAuthorization(api.accessToken ?? null);
    this.unsubscribe.push(
      musicPlayer.onTrackChange((change) => this.trackChanged(change)),
      musicPlayer.onStateChange((player) => this.update({ player })),
      musicPlayer.onError((error) => console.warn("music playback", error.videoId, error.message)),
      musicPlayer.onSleep(() => setSleepTimer("off")),
      onSleepTimerChange(() => this.syncSleepTimer()),
    );
    this.syncSleepTimer();
    // Music left playing from before the app's screens were rebuilt.
    void musicPlayer.getState().then((player) => { if (player) this.update({ player }); });
  }

  snapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(patch: Partial<MusicSessionState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private syncSleepTimer() {
    const timer = sleepTimer();
    void musicPlayer.setSleepTimer(timer.kind === "time" ? timer.deadline : 0, timer.kind === "end");
  }

  /** Starts a station, replacing whatever was playing. */
  async start(seed: MusicSeed) {
    const generation = ++this.generation;
    this.update({ starting: true, error: null });
    try {
      const station = await this.api.station(seed, [], [], 10);
      if (generation !== this.generation) return;
      if (!station.tracks.length) { this.update({ starting: false, error: "empty" }); return; }
      await this.recordReplaced();
      const queue = createQueue(seed, station.seed, station.tracks, new Date());
      this.update({ queue, starting: false });
      await musicPlayer.setQueue(queue.tracks.map((track) => this.api.playerTrack(track)), 0, true);
      this.prepare(queue.tracks[1]?.videoId ?? null);
    } catch (error) {
      if (generation === this.generation) this.update({ starting: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private trackChanged(change: MusicTrackChange) {
    const queue = this.state.queue;
    if (!queue) return;
    const result = applyTrackChange(queue, change, new Date());
    this.update({ queue: result.queue });
    if (result.play) this.api.recordPlay(result.play).catch(() => {});
    this.prepare(result.prepare);
    if (needsMore(result.queue)) void this.refill();
  }

  private prepare(videoId: string | null) {
    if (videoId) this.api.prepare(videoId).catch(() => {});
  }

  private async refill() {
    if (this.refilling) return;
    const queue = this.state.queue;
    if (!queue) return;
    this.refilling = true;
    const generation = this.generation;
    try {
      const station = await this.api.station(queue.seed, served(queue), queue.skipped, 10);
      const latest = this.state.queue;
      if (generation !== this.generation || !latest) return;
      const { queue: next, added } = appendTracks(latest, station.tracks);
      if (!added.length) return;
      this.update({ queue: next });
      await musicPlayer.append(added.map((track) => this.api.playerTrack(track)));
      // The song after the current one may have just arrived.
      if (next.index + 1 === latest.tracks.length) this.prepare(added[0]?.videoId ?? null);
    } catch {
      // The next song change asks again.
    } finally { this.refilling = false; }
  }

  togglePlay() {
    if (this.state.player?.playing) void musicPlayer.pause();
    else void musicPlayer.play();
  }

  next() { void musicPlayer.next(); }
  previous() { void musicPlayer.previous(); }
  seekTo(seconds: number) { void musicPlayer.seekTo(seconds); }

  skipTo(videoId: string) {
    const index = this.state.queue?.tracks.findIndex((track) => track.videoId === videoId) ?? -1;
    if (index >= 0) void musicPlayer.skipTo(index);
  }

  async like(track: MusicTrack, liked: boolean) {
    this.setRating(track.videoId, liked ? 1 : null);
    try { await this.api.rate(track.videoId, liked ? 1 : 0); }
    catch { this.setRating(track.videoId, track.rating); }
  }

  /** "Not this one": the song is never picked again and leaves the queue now. */
  async dislike(track: MusicTrack) {
    this.api.rate(track.videoId, -1).catch(() => {});
    const queue = this.state.queue;
    if (!queue) return;
    const index = queue.tracks.findIndex((entry) => entry.videoId === track.videoId);
    if (index === queue.index) {
      this.update({ queue: rateTrack(queue, track.videoId, -1) });
      await musicPlayer.next();
    } else if (index > queue.index) {
      await musicPlayer.removeAt(index);
      const next = removeTrack(queue, index);
      this.update({ queue: next });
      if (needsMore(next)) void this.refill();
    }
  }

  private setRating(videoId: string, rating: 1 | -1 | null) {
    if (this.state.queue) this.update({ queue: rateTrack(this.state.queue, videoId, rating) });
  }

  current(): MusicTrack | null { return current(this.state.queue); }

  private recordLast(queue: MusicQueue | null, last: MusicPlayerProgress | null) {
    if (!queue || !last) return;
    const play = playFor(queue, last, endReason({ reason: "playlist" }, last), queue.startedAt);
    if (play) this.api.recordPlay(play).catch(() => {});
  }

  /** A new station is replacing the one playing: record how far its song got. */
  private async recordReplaced() {
    const queue = this.state.queue;
    const state = await musicPlayer.getState();
    if (state?.videoId) this.recordLast(queue, { videoId: state.videoId, position: state.position, duration: state.duration ?? 0 });
  }

  /** Records how far the last song got, then forgets the station. */
  private async recordStop() {
    const queue = this.state.queue;
    this.recordLast(queue, await musicPlayer.stop());
    this.update({ queue: null, player: null });
  }

  /** Ends music: leaving music mode, switching profile, signing out. */
  async stop() {
    this.generation++;
    await this.recordStop();
  }

  dispose() {
    this.unsubscribe.forEach((stop) => stop());
    this.listeners.clear();
  }
}

export function useMusicSession(session: MusicSession): MusicSessionState {
  return useSyncExternalStore(session.subscribe, session.snapshot);
}
