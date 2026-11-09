import type { VideoPlayer } from "expo-video";
import type { YtZeroApi } from "./api";
import { resumePosition } from "./playback";
import { playableSpeed } from "./playbackSpeeds";
import type { PlaybackTicket, Video } from "./types";

type BufferApi = Pick<YtZeroApi, "playbackTicket" | "playbackSource" | "renewPlaybackTicket" | "releasePlaybackTicket">;
type PlaybackControl = { play: (player: VideoPlayer) => Promise<void>; pause: (player: VideoPlayer) => Promise<void> };
export type BufferedPlayback = {
  video: Video;
  player: VideoPlayer;
  ready: Promise<void>;
  initialPosition: number;
  error: unknown;
  dispose: () => void;
};

/** Memory-only native players. Preparing a neighbour never records a play. */
export class PlaybackBuffer {
  private entries = new Map<string, BufferedPlayback>();
  private protectedIds = new Map<string, number>();
  // null: no channel speed; the profile default is read when playback starts.
  private initialRates = new WeakMap<BufferedPlayback, number | null>();
  private activeEntry: BufferedPlayback | null = null;
  private playbackVersion = 0;
  constructor(
    private api: BufferApi,
    private createPlayer: () => VideoPlayer,
    private seek: (player: VideoPlayer, seconds: number) => Promise<void>,
    private onFailure: (entry: BufferedPlayback, error: unknown) => void,
    private unload: (player: VideoPlayer) => Promise<void> = async (player) => { await player.replaceAsync(null); },
    private control: PlaybackControl = { play: async (player) => { player.play(); }, pause: async (player) => { player.pause(); } },
    /** The profile's default speed, used when the video's channel has none. */
    private defaultSpeed: () => unknown = () => 1,
  ) {}

  prepare(video: Video, position = resumePosition(video.watch_position, video.watch_duration, video.watched)): BufferedPlayback {
    const live = video.live_status === "live";
    if (live) position = 0;
    const existing = this.entries.get(video.video_id);
    if (existing && !existing.error) return existing;
    existing?.dispose();
    const player = this.createPlayer();
    player.muted = true;
    const controller = new AbortController();
    let disposed = false;
    let loaded = false;
    let playable = false;
    let ticket: PlaybackTicket | null = null;
    let sourceUri = "";
    let fellBack = false;
    let renewTimer: ReturnType<typeof setInterval> | undefined;
    let loading: Promise<void> = Promise.resolve();
    let resolveReady!: () => void;
    let rejectReady!: (reason: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // A speculative neighbour may fail before the user chooses it.
    void ready.catch(() => {});
    const fail = (error: unknown) => {
      if (disposed || entry.error) return;
      entry.error = error;
      if (this.activeEntry === entry) { this.activeEntry = null; this.playbackVersion++; }
      void this.silence(player).catch(() => {});
      clearTimeout(timeout);
      clearInterval(renewTimer);
      controller.abort();
      rejectReady(error);
      this.onFailure(entry, error);
    };
    let timeout = setTimeout(() => fail(new Error("Playback preparation timed out")), 10 * 60_000);
    const checkReady = () => {
      if (!disposed && !entry.error && loaded && playable) { clearTimeout(timeout); resolveReady(); }
    };
    const listeners = [
      player.addListener("playingChange", ({ isPlaying }) => {
        // Native controls or a late native command must never start a neighbour.
        if (isPlaying && this.activeEntry !== entry) void this.silence(player).catch(() => {});
      }),
      player.addListener("statusChange", ({ status, error }) => {
        if (status === "error" && sourceUri) {
          // A full-quality stream YouTube stops serving mid-way fails the player.
          // Switch once to the single progressive stream at the same position
          // instead of ending playback.
          if (!fellBack && !live && /\/direct-hls\//.test(sourceUri)) {
            fellBack = true;
            if (player.currentTime > 0) position = player.currentTime;
            loaded = false;
            playable = false;
            sourceUri = "";
            loading = loadSource("progressive");
            return;
          }
          fail(error ?? new Error("Native source failed"));
        }
        playable = status === "readyToPlay";
        checkReady();
      }),
      player.addListener("sourceLoad", ({ videoSource, duration, availableSubtitleTracks }) => {
        const uri = typeof videoSource === "string" ? videoSource : typeof videoSource === "object" ? videoSource?.uri : null;
        if (disposed || !sourceUri || sourceUri !== uri) return;
        if (!live && (!Number.isFinite(duration) || duration <= 0)) { fail(new Error("Invalid playback duration")); return; }
        void (async () => {
          try {
            if (position > 0) await this.seek(player, Math.min(position, Math.max(0, duration - 1)));
            if (disposed || entry.error) return;
            if (video.channel_caption_mode === "off") player.subtitleTrack = null;
            else if (video.channel_caption_language) {
              const track = availableSubtitleTracks.find((item) => item.language === video.channel_caption_language);
              if (track) player.subtitleTrack = track;
            }
            loaded = true;
            checkReady();
            // After a fallback the viewer is already watching: keep playing.
            if (fellBack && this.activeEntry === entry) await this.control.play(player);
          } catch (error) { fail(error); }
        })();
      }),
    ];
    const releaseTicket = (authorization: PlaybackTicket) => {
      void this.api.releasePlaybackTicket(video.video_id, authorization.ticket).catch(() => {});
    };
    const entry: BufferedPlayback = {
      video, player, ready, initialPosition: position, error: null,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (this.activeEntry === entry) { this.activeEntry = null; this.playbackVersion++; }
        void this.silence(player).catch(() => {});
        controller.abort();
        clearTimeout(timeout);
        clearInterval(renewTimer);
        listeners.forEach((listener) => listener.remove());
        rejectReady(new Error("Playback buffer released"));
        // Cancel source preparation now, then drain any replacement already
        // crossing the native bridge. Revoke authorization only after AVPlayer
        // has stopped using the asset; otherwise its last requests receive 401.
        void (async () => {
          await player.replaceAsync(null).catch(() => {});
          await loading.catch(() => {});
          await this.unload(player).catch(() => {});
          player.release();
        })().catch(() => {}).finally(() => {
          if (ticket) { releaseTicket(ticket); ticket = null; }
        });
      },
    };
    this.entries.set(video.video_id, entry);
    this.initialRates.set(entry, live ? 1 : playableSpeed(video.channel_playback_speed ?? null));
    // Loads a ticket's source into this player: first the server's choice,
    // then once, after a full-quality stream fails, the progressive stream.
    const loadSource = async (prefer?: "progressive") => {
      try {
        const authorization = await this.api.playbackTicket(video.video_id, controller.signal, prefer);
        if (disposed) { releaseTicket(authorization); return; }
        if (ticket) releaseTicket(ticket);
        clearInterval(renewTimer);
        ticket = authorization;
        const source = this.api.playbackSource(authorization);
        sourceUri = source.uri;
        clearTimeout(timeout);
        timeout = setTimeout(() => fail(new Error("Native source timed out")), 60_000);
        renewTimer = setInterval(() => {
          void this.api.renewPlaybackTicket(video.video_id, authorization.ticket).catch(fail);
        }, Math.max(10_000, authorization.expires_in * 1000 / 3));
        await player.replaceAsync({ ...source, useCaching: false, metadata: { title: video.title, artist: video.channel_title } });
        if (!disposed) { playable = player.status === "readyToPlay"; checkReady(); }
      } catch (error) { fail(error); }
    };
    loading = loadSource();
    return entry;
  }

  private async silence(player: VideoPlayer) {
    // Mute immediately, before waiting for a pause to cross the native bridge.
    player.muted = true;
    await this.control.pause(player);
  }

  /** Only the player attached to the visible view may acquire audio ownership. */
  async play(entry: BufferedPlayback): Promise<boolean> {
    const version = ++this.playbackVersion;
    this.activeEntry = null;
    await Promise.all([...this.entries.values()].map((item) => this.silence(item.player)));
    const current = () => version === this.playbackVersion && this.entries.get(entry.video.video_id) === entry && !entry.error;
    if (!current()) return false;
    this.activeEntry = entry;
    try {
      const initial = this.initialRates.get(entry);
      if (initial !== undefined) {
        const speed = initial ?? playableSpeed(this.defaultSpeed()) ?? 1;
        // expo-video's Apple setter writes AVPlayer.rate, which starts playback.
        // Apply it only here, while the selected player is still muted.
        entry.player.playbackRate = speed;
        this.initialRates.delete(entry);
      }
      await this.control.play(entry.player);
      if (current()) { entry.player.muted = false; return true; }
    } catch (error) {
      if (current()) this.activeEntry = null;
      if (this.activeEntry !== entry) await this.silence(entry.player).catch(() => {});
      throw error;
    }
    if (this.activeEntry !== entry) await this.silence(entry.player).catch(() => {});
    return false;
  }

  async pause() {
    this.playbackVersion++;
    this.activeEntry = null;
    await Promise.all([...this.entries.values()].map((entry) => this.silence(entry.player)));
  }

  retain(ids: string[]) {
    const keep = new Set(ids);
    for (const [id, entry] of this.entries) if (!keep.has(id) && !this.protectedIds.has(id)) {
      this.entries.delete(id);
      entry.dispose();
    }
  }

  /** Protect both ends until the native view acknowledges a player swap. */
  protect(ids: string[]) {
    const unique = [...new Set(ids)];
    unique.forEach((id) => this.protectedIds.set(id, (this.protectedIds.get(id) ?? 0) + 1));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      unique.forEach((id) => {
        const count = (this.protectedIds.get(id) ?? 0) - 1;
        if (count > 0) this.protectedIds.set(id, count); else this.protectedIds.delete(id);
      });
    };
  }

  dispose() { this.playbackVersion++; this.activeEntry = null; this.protectedIds.clear(); this.retain([]); }
}
