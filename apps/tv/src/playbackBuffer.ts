import type { BufferOptions, VideoPlayer } from "expo-video";
import type { YtZeroApi } from "./api";
import { resumePosition } from "./playback";
import { playableSpeed } from "./playbackSpeeds";
import type { PlaybackTicket, Video } from "./types";

type BufferApi = Pick<YtZeroApi, "playbackTicket" | "playbackSource" | "renewPlaybackTicket" | "releasePlaybackTicket">;
// A ticket this close to its expiry is treated as expired: a stream error then
// most likely means the server stopped accepting it.
const ticketMargin = 30_000;
const errorStatus = (error: unknown) => (error as { status?: unknown } | null)?.status;
// The server refused the video itself (restricted, removed, unavailable): renewing again cannot help.
const ticketRefused = (error: unknown) => [403, 404, 409].includes(errorStatus(error) as number);
type PlaybackControl = { play: (player: VideoPlayer) => Promise<void>; pause: (player: VideoPlayer) => Promise<void> };
export type BufferedPlayback = {
  video: Video;
  player: VideoPlayer;
  ready: Promise<void>;
  initialPosition: number;
  error: unknown;
  /** Reloads the source at the current position, e.g. after the stream quality changed. */
  reload: () => void;
  /**
   * Replaces a ticket that lapsed while the app was away, before the viewer
   * presses Play: the paused player would otherwise buffer forever on refused segments.
   */
  refresh: () => void;
  /** Whether playback is held up, and whether the viewer paused it there. */
  waitState: () => PlaybackWait;
  onWaitChange: (listener: () => void) => () => void;
  /** The viewer's pause: nothing starts playback again, not even a reconnect, until resume(). */
  hold: () => void;
  /** The viewer's play: resumes, trying the server at once if the stream was lost. */
  resume: () => void;
  dispose: () => void;
};
/** "buffering": waiting for data; "reconnecting": the stream was lost and is being loaded again. */
export type PlaybackWait = { waiting: "none" | "buffering" | "reconnecting"; held: boolean };

/** The server answered and refused the renewal (an expired or revoked ticket), rather than being unreachable. */
const renewalRefused = (error: unknown): boolean => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429;
};

/** No answer from the server at all (offline, between networks), or a gateway that lost it for a moment. */
const unreachable = (error: unknown): boolean => {
  const value = error as { status?: unknown; name?: unknown } | null;
  if (value?.name === "AbortError") return false;
  return typeof value?.status !== "number" || [408, 429, 502, 504].includes(value.status);
};

/** ExoPlayer names the HTTP status when the stream answered and refused, e.g. "Response code: 403". */
const streamRefused = (error: unknown): boolean =>
  /response code:\s*[45]\d\d/i.test(String((error as { message?: unknown } | null)?.message ?? ""));

/** Waits between attempts to reach the server again after the connection dropped mid-video. */
const RECONNECT_DELAYS = [1000, 2000, 3000, 5000];
/** Reloads of a playing video that may follow one another before the next failure is final. */
const MAX_RECOVERIES = 3;
/** Playing this long after a reload shows the stream is healthy again. */
const RECOVERY_SETTLE_MS = 60_000;

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
    /** The stream quality to ask for ("" for the server's choice, "fast" for the progressive stream). */
    private quality: () => string = () => "",
    /** The native buffer for a player: the playing one may buffer further ahead than its neighbours. */
    private bufferOptions?: (active: boolean) => BufferOptions,
    private now: () => number = Date.now,
  ) {}
  private appliedBuffers = new WeakMap<VideoPlayer, string>();

  private applyBuffer(entry: BufferedPlayback, active: boolean) {
    if (!this.bufferOptions) return;
    const options = this.bufferOptions(active);
    const key = JSON.stringify(options);
    // Each assignment crosses the native bridge: skip ones that change nothing.
    if (this.appliedBuffers.get(entry.player) === key) return;
    this.appliedBuffers.set(entry.player, key);
    entry.player.bufferOptions = options;
  }

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
    // After a fallback or reload the viewer is already watching: keep playing.
    let resume = false;
    // The ticket preference of the source loaded now, reused to reload the same stream.
    let preference: "progressive" | undefined;
    // Became ready once: a later failure interrupts a video the viewer is watching.
    let started = false;
    // Whether the viewer last had it playing; a stall is not a pause.
    let wantsPlay = false;
    let lastStatus = "idle";
    let lastTime = 0;
    let recoveries = 0;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    // The stream was lost and has not loaded again yet.
    let reconnecting = false;
    // The viewer paused while playback was held up. Loading carries on; playing waits for them.
    let held = false;
    let requesting = false;
    const waitListeners = new Set<() => void>();
    const waitState = (): PlaybackWait => ({
      waiting: reconnecting ? "reconnecting" : started && lastStatus === "loading" ? "buffering" : "none", held,
    });
    const emitWait = () => waitListeners.forEach((listener) => listener());
    // Android stops the app's timers while it is in the background, so a long
    // pause or a screen-off session can outlive the ticket without a renewal.
    let ticketValidUntil = 0;
    let renewalFailed = false;
    const ticketStale = () => renewalFailed || this.now() >= ticketValidUntil - ticketMargin;
    let renewTimer: ReturnType<typeof setInterval> | undefined;
    let renewRetry: ReturnType<typeof setTimeout> | undefined;
    const stopRenewing = () => { clearInterval(renewTimer); clearTimeout(renewRetry); clearTimeout(reconnectTimer); clearTimeout(settleTimer); };
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
      stopRenewing();
      controller.abort();
      rejectReady(error);
      this.onFailure(entry, error);
    };
    let timeout = setTimeout(() => fail(new Error("Playback preparation timed out")), 10 * 60_000);
    const checkReady = () => {
      if (!disposed && !entry.error && loaded && playable) { clearTimeout(timeout); started = true; resolveReady(); }
    };
    // Loads the source again where the viewer was, with a fresh ticket. The
    // ticket request doubles as the test that the server is reachable again.
    const reloadAt = (prefer: "progressive" | undefined, keepPlaying: boolean) => {
      // A failed player can report 0: fall back to where it last played.
      if (!live) position = player.currentTime > 0 ? player.currentTime : lastTime || position;
      resume = keepPlaying;
      clearTimeout(timeout);
      // The old ticket is replaced: stop renewing it.
      stopRenewing();
      loaded = false;
      playable = false;
      sourceUri = "";
      loading = loadSource(prefer);
    };
    // Loads the same stream again with a new ticket, showing the reconnect until it plays.
    const reconnect = (keepPlaying: boolean) => {
      reconnecting = true;
      reloadAt(preference, keepPlaying && !held);
      emitWait();
    };
    // A video that was playing and lost its stream: reload it rather than end it.
    const recover = () => {
      recoveries++;
      reconnect(this.activeEntry === entry && wantsPlay);
    };
    const listeners = [
      player.addListener("timeUpdate", ({ currentTime }) => { if (loaded && currentTime > 0) lastTime = currentTime; }),
      player.addListener("playingChange", ({ isPlaying }) => {
        // Native controls or a late native command must never start a neighbour.
        if (isPlaying && this.activeEntry !== entry) void this.silence(player).catch(() => {});
        // Running out of buffer reports "loading" first; only a pause while ready is the viewer's.
        if (isPlaying) { wantsPlay = true; if (held) { held = false; emitWait(); } }
        else if (lastStatus === "readyToPlay") wantsPlay = false;
      }),
      player.addListener("statusChange", ({ status, error }) => {
        lastStatus = status;
        // A loaded stream that starts buffering after its ticket lapsed is
        // being refused segments; ExoPlayer can keep retrying them without failing.
        if (status === "loading" && sourceUri && loaded && recoveries < MAX_RECOVERIES && ticketStale()) { recover(); return; }
        if (status === "error" && sourceUri) {
          // The connection dropped and the buffer ran out (the stream went
          // unanswered), or the ticket lapsed while paused or in the
          // background (the stream refused it). Either way, reload the same
          // stream at the same position with a new ticket, waiting for the
          // network to come back if need be.
          if (started && recoveries < MAX_RECOVERIES && (ticketStale() || !streamRefused(error))) { recover(); return; }
          // A full-quality stream YouTube stops serving mid-way fails the player.
          // Switch once to the single progressive stream at the same position
          // instead of ending playback.
          if (!fellBack && !live && /\/direct-hls\//.test(sourceUri)) {
            fellBack = true;
            reloadAt("progressive", !held);
            return;
          }
          fail(error ?? new Error("Native source failed"));
        }
        playable = status === "readyToPlay";
        checkReady();
        emitWait();
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
            reconnectAttempt = 0;
            if (reconnecting) { reconnecting = false; emitWait(); }
            clearTimeout(settleTimer);
            if (recoveries > 0) settleTimer = setTimeout(() => { recoveries = 0; }, RECOVERY_SETTLE_MS);
            if (resume && !held && this.activeEntry === entry) await this.control.play(player);
          } catch (error) { fail(error); }
        })();
      }),
    ];
    const releaseTicket = (authorization: PlaybackTicket) => {
      void this.api.releasePlaybackTicket(video.video_id, authorization.ticket).catch(() => {});
    };
    const entry: BufferedPlayback = {
      video, player, ready, initialPosition: position, error: null,
      reload: () => {
        if (disposed || entry.error || live || !sourceUri) return;
        fellBack = false;
        reloadAt(!live && this.quality() === "fast" ? "progressive" : undefined, this.activeEntry === entry && player.playing);
      },
      refresh: () => {
        if (disposed || entry.error || !sourceUri || !loaded || reconnecting || !ticketStale()) return;
        reconnect(this.activeEntry === entry && player.playing);
      },
      waitState,
      onWaitChange: (listener) => { waitListeners.add(listener); return () => { waitListeners.delete(listener); }; },
      hold: () => {
        if (disposed || entry.error) return;
        held = true;
        wantsPlay = false;
        resume = false;
        void this.control.pause(player).catch(() => {});
        emitWait();
      },
      resume: () => {
        if (disposed || entry.error) return;
        held = false;
        wantsPlay = true;
        resume = true;
        if (reconnecting && !sourceUri) {
          // Waiting between attempts: try now rather than at the next one.
          if (!requesting) { clearTimeout(reconnectTimer); reconnectAttempt = 0; loading = loadSource(preference); }
        } else if (this.activeEntry === entry) void this.control.play(player).catch(() => {});
        emitWait();
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (this.activeEntry === entry) { this.activeEntry = null; this.playbackVersion++; }
        void this.silence(player).catch(() => {});
        controller.abort();
        clearTimeout(timeout);
        stopRenewing();
        listeners.forEach((listener) => listener.remove());
        waitListeners.clear();
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
      preference = prefer;
      requesting = true;
      try {
        const authorization = await this.api.playbackTicket(video.video_id, controller.signal, prefer, prefer || live ? undefined : this.quality());
        requesting = false;
        if (disposed) { releaseTicket(authorization); return; }
        if (ticket) releaseTicket(ticket);
        stopRenewing();
        ticket = authorization;
        ticketValidUntil = this.now() + authorization.expires_in * 1000;
        renewalFailed = false;
        const source = this.api.playbackSource(authorization);
        sourceUri = source.uri;
        clearTimeout(timeout);
        timeout = setTimeout(() => fail(new Error("Native source timed out")), 60_000);
        const renew = () => {
          clearTimeout(renewRetry);
          // The timer stopped while the app was in the background: renewing a lapsed ticket fails.
          if (loaded && this.now() >= ticketValidUntil) { entry.refresh(); return; }
          void this.api.renewPlaybackTicket(video.video_id, authorization.ticket).then((renewed) => {
            if (ticket !== authorization) return;
            ticketValidUntil = this.now() + renewed.expires_in * 1000;
            renewalFailed = false;
          }, (error) => {
            if (disposed || entry.error || ticket !== authorization) return;
            // The server refused the video itself: a new ticket cannot help.
            if (ticketRefused(error)) { fail(error); return; }
            renewalFailed = true;
            // The ticket ran out, e.g. while the phone was offline for a long
            // time: a video already playing asks for a new one and carries on.
            if (renewalRefused(error)) {
              if (!started || recoveries >= MAX_RECOVERIES) fail(error);
              // An empty source means a reload is already asking for one.
              else if (sourceUri) recover();
              return;
            }
            // No connection for a moment, e.g. between wifi hotspots: the
            // ticket outlives several renewals, so keep playing from the
            // buffer and try again soon instead of ending playback.
            renewRetry = setTimeout(renew, Math.max(1000, Math.min(15_000, authorization.expires_in * 1000 / 6)));
          });
        };
        renewTimer = setInterval(renew, Math.max(10_000, authorization.expires_in * 1000 / 3));
        await player.replaceAsync({ ...source, useCaching: false, metadata: { title: video.title, artist: video.channel_title } });
        if (!disposed) { playable = player.status === "readyToPlay"; checkReady(); }
      } catch (error) {
        requesting = false;
        // Still offline: keep the video where it stopped and try again shortly.
        if (started && !disposed && !entry.error && unreachable(error)) {
          const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt++, RECONNECT_DELAYS.length - 1)]!;
          reconnectTimer = setTimeout(() => { if (!disposed && !entry.error) loading = loadSource(prefer); }, delay);
          return;
        }
        fail(error);
      }
    };
    // "fast" goes straight to the progressive stream: no high-quality attempt to wait out.
    const firstSource = () => loadSource(!live && this.quality() === "fast" ? "progressive" : undefined);
    loading = firstSource();
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
    // The playing video buffers as far ahead as this device asks; neighbours keep the short buffer.
    for (const item of this.entries.values()) this.applyBuffer(item, item === entry);
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

  /** Re-reads the buffer choice for every player, e.g. after the device setting changed mid-video. */
  refreshBuffers() {
    for (const item of this.entries.values()) this.applyBuffer(item, item === this.activeEntry);
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
