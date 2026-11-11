import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createVideoPlayer, VideoView, type VideoPlayer } from "expo-video";
import { ActivityIndicator, AppState, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { SafeAreaProvider, SafeAreaView, type Edge } from "react-native-safe-area-context";
import { speedLabel, speedMemoryTarget, speedOptions } from "../playbackSpeeds";
import { heightLabel, qualityButtonLabel, qualityChoiceLabel, saveStreamQuality, STREAM_QUALITIES, streamQuality, type StreamQuality } from "../streamQuality";
import { deviceStore } from "../deviceStore";
import { forwardBuffer, forwardBufferOptions, NEIGHBOUR_BUFFER_OPTIONS, onForwardBufferChange } from "../forwardBuffer";
import { sponsorCategories } from "../sponsorBlock";
import { useSponsorBlock } from "../useSponsorBlock";
import { useKeepScreenAwake } from "../useKeepScreenAwake";
import { useSleepTimer } from "../useSleepTimer";
import { setSleepTimer, sleepCountdownLabel, sleepTimer, sleepTimerChoice, SLEEP_TIMER_CHOICES, type SleepTimerChoice } from "../sleepTimer";
import { TvChoiceSheet } from "./TvChoiceSheet";
import { useMiniPlayerSlot, usePlayerWindowSlot } from "./MiniPlayerHost";
import { setPhoneImmersive } from "../phoneOrientation";
import { leavesIntoPictureInPicture, onPictureInPictureDismiss } from "../pictureInPicture";
import { TvMiniPlayer } from "./TvMiniPlayer";
import { PlaybackWaitOverlay } from "./PlaybackWaitOverlay";
import { ApiError, type YtZeroApi } from "../api";
import type { Translate } from "../i18n";
import { PlaybackProgress, validPlaybackPosition, type PlaybackResult } from "../playback";
import { PlaybackBuffer, type BufferedPlayback } from "../playbackBuffer";
import { localProgress } from "../storage";
import type { TvProfileSettings, Video } from "../types";
import { colors, typography, screenPadding } from "../theme";
import { TvBackButton } from "./TvBackButton";
import { TvButton } from "./TvButton";
import { TvLoadingMark } from "./TvLoadingMark";
import { dismissPlayer, playPlayer, pausePlayer, seekPlayer, setPlayerMetadata, isPlayerAttached, unloadPlayer } from "../playerControl";
import { waitForPlayerAttachment } from "../playerAttachment";
import { reportPlaybackDiagnostic } from "../reportPlaybackDiagnostic";
import type { PlaybackStage } from "../playbackDiagnostics";
import { clearPlayerQueue, subscribePlayerQueue, updatePlayerQueue } from "../playerQueueControl";
import { shortsNavigation, type PlaybackQueueContext } from "../playbackQueue";
import { focusWhenReady, suspendBackgroundFocusRedirects } from "../focus";
import { TvFocusScope } from "./TvFocusScope";
import { useTvModalBack } from "../useTvModalBack";

type Props = {
  api: YtZeroApi; video: Video; startPosition: number; incognito: boolean; isChild: boolean; t: Translate;
  queueVideos: Video[]; nextVideo: Video | null; previousVideo: Video | null; queueLoading: boolean;
  advanceOnEnd: boolean; queueContext: PlaybackQueueContext | null;
  onAdvance: (video: Video) => void;
  onProgress: (video: Video, result: PlaybackResult) => void;
  onClose: (result: PlaybackResult, next?: Video, playedVideo?: Video) => void;
  /** Phones: Back minimizes the player to a corner, and the viewer keeps browsing. */
  docked?: boolean; onDock?: () => void; onExpand?: () => void;
  /**
   * Phones: "inline" draws the player in the details page. "modal" is fullscreen: a Modal
   * on TVs, and on Android phones a window-sized view above the app (see `playsInWindow`).
   */
  presentation?: "modal" | "inline"; onToggleFullscreen?: () => void; fullscreenActive?: boolean;
  /** The profile's server settings: default speed, remembered speed, SponsorBlock. */
  settings?: TvProfileSettings | null; onSettingsChange?: (patch: Partial<TvProfileSettings>) => void;
};
const presentsNativeFullscreen = Platform.OS === "ios";
// Android plays inline with ExoPlayer's controls, whose speed menu stops at 2×,
// so it gets the app's own speed button instead.
const ownsSpeedControl = Platform.OS === "android";
const playsInBackground = Platform.OS === "android";
const canDock = Platform.OS === "android" && !Platform.isTV;
// A Modal is a window of its own, whose status and navigation bars the app cannot
// hide. Android phones in the scaled TV layout cover the app's own window instead,
// with the bars hidden until a swipe from the edge.
const playsInWindow = Platform.OS === "android" && !Platform.isTV;
// Progress is saved this often while playing. It counts from the player's own time
// updates: Android stops the app's timers in the background, not those.
const heartbeatInterval = 5000;
const speedButtonTimeout = 4000;
const skippedNoticeTimeout = 3000;
// A touch that moves this far, or lasts this long, is a drag (the seek bar), not a tap.
const tapSlop = 12;
const tapDuration = 400;
// tvOS keeps its full-screen AVKit presentation and its own overscan handling.
const playerSafeEdges: Edge[] = Platform.OS === "android" ? ["top", "right", "bottom", "left"] : [];

type Failure = "playbackError" | "playbackUnavailable" | "playbackRestricted" | "playbackSessionExpired";
type Session = {
  entry: BufferedPlayback; progress: PlaybackProgress;
  position: { position: number; duration: number }; startPosition: number;
  /** Whether this video's position is saved (not live, not incognito). */
  tracked: boolean; lastBeat: number;
  /** The position the server last held, as far as this device knows: another device may move it. */
  server: number | null;
  didPlay: boolean; completed: boolean; history: Promise<boolean> | null; finished: Promise<PlaybackResult> | null;
};
function playbackFailure(error: unknown): Failure {
  return error instanceof ApiError ? error.status === 403 ? "playbackRestricted" : error.status === 401 ? "playbackSessionExpired"
    : [404, 409, 503].includes(error.status) ? "playbackUnavailable" : "playbackError" : "playbackError";
}

/**
 * The player's position, unless it has none to give: a failed player, or one
 * reloading its source, can report 0, which would overwrite real progress.
 */
function playerPosition(player: VideoPlayer, known: { position: number; duration: number }) {
  if (player.status === "error" || (!(player.currentTime > 0) && known.position > 0)) return known;
  return { position: player.currentTime, duration: player.duration };
}

/** One modal and one AVKit controller for the entire Shorts session. */
export function TvNativePlayer(props: Props) {
  const { api, video, startPosition, incognito, isChild, t, nextVideo, previousVideo, queueVideos, queueLoading, docked = false, presentation = "modal" } = props;
  const dockable = canDock && Boolean(props.onDock);
  const miniPlayerSlot = useMiniPlayerSlot();
  const playerWindowSlot = usePlayerWindowSlot();
  const windowed = playsInWindow && presentation === "modal";
  const windowVisible = windowed && !docked;
  const latest = useRef(props);
  latest.current = props;
  const view = useRef<VideoView>(null);
  const retryButton = useRef<View>(null);
  const detailsButton = useRef<View>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [panelFocused, setPanelFocused] = useState(false);
  const initial = useRef({ video, startPosition });
  const session = useRef<Session | null>(null);
  const alive = useRef(true);
  const closing = useRef(false);
  const switching = useRef(false);
  const transitionLease = useRef<(() => void) | null>(null);
  const activating = useRef<BufferedPlayback | null>(null);
  const fullscreen = useRef(false);
  const modalShown = useRef(false);
  const showDetails = useRef(false);
  const nextSelection = useRef<Video | undefined>(undefined);
  const failure = useRef<Failure | null>(null);
  const pendingSaves = useRef(new Set<Promise<PlaybackResult>>());
  const finishedSessions = useRef(new Map<string, Promise<PlaybackResult>>());
  const saveFailed = useRef(false);
  const handleFailure = useRef<(entry: BufferedPlayback, error: unknown) => void>(() => {});
  const [active, setActive] = useState<BufferedPlayback | null>(null);
  const [ready, setReady] = useState(false);
  const [presented, setPresented] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [switchingVideo, setSwitchingVideo] = useState(false);
  const [rate, setRate] = useState(1);
  const [speedSheet, setSpeedSheet] = useState(false);
  const [qualitySheet, setQualitySheet] = useState(false);
  const [sleepSheet, setSleepSheet] = useState(false);
  const [quality, setQuality] = useState<StreamQuality>(streamQuality);
  // The height of the video track playing now, as ExoPlayer adapts.
  const [trackHeight, setTrackHeight] = useState<number | null>(null);
  const [speedButton, setSpeedButton] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [skippedNotice, setSkippedNotice] = useState<string | null>(null);
  const speedButtonTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const skippedNoticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const speedButtonShown = useRef(false);
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const showSpeedButton = (shown: boolean) => { speedButtonShown.current = shown; setSpeedButton(shown); };
  // The app's buttons show with ExoPlayer's controls: a tap shows them for a
  // few seconds (they stay while paused), and another tap hides them.
  const revealSpeedButton = () => {
    if (!ownsSpeedControl) return;
    showSpeedButton(true);
    clearTimeout(speedButtonTimer.current);
    if (session.current?.entry.player.playing !== false) speedButtonTimer.current = setTimeout(() => showSpeedButton(false), speedButtonTimeout);
  };
  const toggleSpeedButton = () => {
    if (!speedButtonShown.current) { revealSpeedButton(); return; }
    clearTimeout(speedButtonTimer.current);
    showSpeedButton(false);
  };
  useEffect(() => () => { clearTimeout(speedButtonTimer.current); clearTimeout(skippedNoticeTimer.current); }, []);
  const closeRef = useRef<() => void>(() => {});
  // While docked, the same player shows in the mini player above the app.
  useEffect(() => {
    if (!docked || !active) return;
    miniPlayerSlot(<TvMiniPlayer player={active.player} title={active.video.title} t={t}
      onExpand={() => latest.current.onExpand?.()} onClose={() => closeRef.current()} />);
    return () => miniPlayerSlot(null);
  }, [active, docked, miniPlayerSlot, t]);
  const buffer = useMemo(() => new PlaybackBuffer(api, () => {
    const player = createVideoPlayer(null);
    // Half a second keeps SponsorBlock skips close to each segment's start.
    player.timeUpdateEventInterval = 0.5;
    // Android keeps playing with the screen off or the app in the background,
    // with a media notification for the active player (set below).
    player.staysActiveInBackground = playsInBackground;
    player.preservesPitch = true;
    player.audioMixingMode = "doNotMix";
    // Prepared neighbours keep a short buffer; the playing video gets the device's choice.
    player.bufferOptions = NEIGHBOUR_BUFFER_OPTIONS;
    return player;
  }, seekPlayer, (entry, cause) => handleFailure.current(entry, cause), unloadPlayer, { play: playPlayer, pause: pausePlayer },
  () => latest.current.settings?.player_speed,
  // Only Android offers the quality menu; other players keep the server's choice.
  () => ownsSpeedControl ? streamQuality() : "",
  (active) => forwardBufferOptions(forwardBuffer(), active)), [api]);
  useEffect(() => onForwardBufferChange(() => buffer.refreshBuffers()), [buffer]);

  const endTransition = () => {
    transitionLease.current?.();
    transitionLease.current = null;
    switching.current = false;
    setSwitchingVideo(false);
  };

  // `server`: the position the server held, when the video cannot tell (a retry after this device played it).
  const begin = (entry: BufferedPlayback, server = entry.video.watch_position ?? null) => {
    const position = entry.player.status === "readyToPlay" ? entry.player.currentTime : entry.initialPosition;
    // Swiping back quickly must not let a slow save from the previous visit
    // overwrite the newer visit's progress or completion.
    const previousSave = finishedSessions.current.get(entry.video.video_id);
    const videoId = entry.video.video_id;
    const tracked = entry.video.live_status !== "live" && (!incognito || isChild);
    const started: Session = {
      entry, startPosition: position, position: { position, duration: 0 }, tracked, lastBeat: 0, server, didPlay: false, completed: false, history: null, finished: null,
      // The device keeps each position until the server has it (see localProgress.ts).
      progress: new PlaybackProgress(tracked,
        async (value) => { await previousSave; await api.savePlaybackProgress(videoId, value); started.server = value.position; localProgress.synced(videoId, value); },
        async () => { await previousSave; await api.markWatched(videoId); localProgress.clear(videoId); }),
    };
    session.current = started;
    setReady(false);
    setActive(entry);
    void entry.ready.then(async () => {
      if (!alive.current || session.current?.entry !== entry || closing.current || failure.current) return;
      // AVKit reads AVPlayerItem.externalMetadata; expo-video's source metadata
      // only populates its separate, opt-in Now Playing notification manager.
      try { await setPlayerMetadata(entry.player, entry.video.title, entry.video.channel_title ?? ""); }
      catch (cause) { void reportPlaybackDiagnostic(entry.player, "metadata", cause); }
      if (alive.current && session.current?.entry === entry && !closing.current && !failure.current) setReady(true);
    }).catch((cause) => { if (session.current?.entry === entry) fail(playbackFailure(cause), "load", cause); });
  };

  const finish = (current: Session): Promise<PlaybackResult> => {
    if (current.finished) return current.finished;
    if (current.didPlay) current.position = playerPosition(current.entry.player, current.position);
    const value = current.entry.video.live_status === "live" ? { position: 0, duration: 0 }
      : current.didPlay ? current.position : { position: current.startPosition, duration: 0 };
    if (current.tracked && current.didPlay && !current.completed) localProgress.record(current.entry.video.video_id, value, true, current.server);
    // A retained previous player resumes from its last frame, or restarts if it ended.
    current.entry.video = { ...current.entry.video, watch_position: value.position, watch_duration: value.duration,
      watched: current.completed ? 1 : current.entry.video.watched };
    current.finished = Promise.all([current.progress.finish(value, current.completed), current.history]).then(([failed, historyFailed]) => {
      const result = { ...value, completed: current.completed, saveFailed: failed || Boolean(historyFailed) };
      saveFailed.current ||= result.saveFailed;
      return result;
    });
    const pending = current.finished;
    const videoId = current.entry.video.video_id;
    finishedSessions.current.set(videoId, pending);
    pendingSaves.current.add(pending);
    const settled = () => {
      pendingSaves.current.delete(pending);
      // A newer visit may already have installed its own save chain for this
      // video. Only release the entry owned by the promise that just settled.
      if (finishedSessions.current.get(videoId) === pending) finishedSessions.current.delete(videoId);
    };
    void pending.then(settled, settled);
    return pending;
  };

  const close = async () => {
    if (closing.current) return;
    closing.current = true;
    setDismissing(true);
    endTransition();
    const current = session.current;
    if (current) void reportPlaybackDiagnostic(current.entry.player, "closed");
    await buffer.pause().catch(() => {});
    const result = current ? await finish(current) : { position: startPosition, duration: 0, completed: false, saveFailed: false };
    await Promise.all(pendingSaves.current);
    if (alive.current) latest.current.onClose({ ...result, showDetails: showDetails.current, saveFailed: result.saveFailed || saveFailed.current }, nextSelection.current, current?.entry.video);
  };

  closeRef.current = () => void close();

  const exitPresentation = async () => {
    try {
      if (session.current && await dismissPlayer(session.current.entry.player)) {
        fullscreen.current = false;
        setPresented(false);
        if (!failure.current) void close();
      } else if (fullscreen.current) await view.current?.exitFullscreen();
      else if (!failure.current) void close();
    } catch (cause) { fail("playbackError", "dismiss", cause); }
  };

  const fail = (reason: Failure, stage: PlaybackStage = "load", cause: unknown = new Error(reason)) => {
    if (!alive.current || closing.current || failure.current) return;
    const current = session.current;
    if (current) {
      void reportPlaybackDiagnostic(current.entry.player, stage, cause);
      // Keep where the viewer got to: Try again resumes there, and so does a later visit.
      if (current.didPlay && !current.finished) {
        current.position = playerPosition(current.entry.player, current.position);
        current.progress.update(current.position);
        if (current.tracked) localProgress.record(current.entry.video.video_id, current.position, true, current.server);
      }
    }
    failure.current = reason;
    endTransition();
    nextSelection.current = undefined;
    setError(reason);
    void buffer.pause().catch(() => {});
    if (fullscreen.current) void exitPresentation();
    // A failure shows its message and retry in the full player.
    if (latest.current.docked) latest.current.onExpand?.();
  };
  handleFailure.current = (entry, cause) => { if (session.current?.entry === entry) fail(playbackFailure(cause), "load", cause); };

  const advance = async (target: Video) => {
    const current = session.current;
    if (!current || closing.current || switching.current || failure.current || target.video_id === current.entry.video.video_id) return;
    switching.current = true;
    setSwitchingVideo(true);
    transitionLease.current = buffer.protect([current.entry.video.video_id, target.video_id]);
    if (current.entry.video.is_short !== 1 || target.is_short !== 1) {
      nextSelection.current = target;
      await exitPresentation();
      return;
    }
    const wasPlaying = current.entry.player.playing;
    let next: BufferedPlayback | undefined;
    try {
      await buffer.pause();
      // Keep the paused frame until the neighbour is ready. Never dismiss AVKit
      // or remove the React Native Modal/VideoView during a Shorts transition.
      buffer.retain([current.entry.video.video_id, target.video_id]);
      next = buffer.prepare(target);
      try { await next.ready; }
      catch {
        if (!alive.current || closing.current || failure.current) return;
        // A speculative HTTP failure must not poison the chosen item forever.
        // Retry once with a fresh native item and scoped authorization.
        next = buffer.prepare(target);
        await next.ready;
      }
      if (!alive.current || closing.current || failure.current || session.current !== current) return;
      if (isChild && (await api.playbackRestriction()).locked) { fail("playbackRestricted"); return; }
      if (!alive.current || closing.current || failure.current) return;
      if (next.video.watched === 1) await seekPlayer(next.player, 0);
      if (!alive.current || closing.current || failure.current) return;
      if (next.error) throw next.error;
      const saving = finish(current);
      const playedVideo = current.entry.video;
      void saving.then((result) => { if (alive.current) latest.current.onProgress(playedVideo, result); });
      begin(next);
      latest.current.onAdvance(next.video);
      // The guard is released after the player prop commits and playback starts.
    } catch (cause) {
      if (!alive.current || closing.current || failure.current) return;
      const reason = playbackFailure(cause);
      if (reason === "playbackRestricted" || reason === "playbackSessionExpired" || session.current !== current) {
        fail(reason, "load", cause);
        return;
      }
      if (next) void reportPlaybackDiagnostic(next.player, "load", cause);
      // Keep the current player and re-arm remote input when a neighbour fails.
      // An ended Short stays paused, avoiding an automatic retry loop.
      endTransition();
      buffer.retain([current.entry.video.video_id]);
      if (wasPlaying && !current.completed) void buffer.play(current.entry).catch((error) => fail("playbackError", "present", error));
    }
  };

  useEffect(() => {
    alive.current = true;
    const releaseFocus = suspendBackgroundFocusRedirects();
    return () => {
      alive.current = false;
      transitionLease.current?.();
      transitionLease.current = null;
      const current = session.current;
      if (current) {
        void clearPlayerQueue(current.entry.player).catch(() => {});
        void finish(current);
      }
      buffer.dispose();
      releaseFocus();
    };
  }, [buffer]);

  useEffect(() => {
    failure.current = null;
    setError(null);
    const previous = session.current;
    const target = previous?.entry.video ?? initial.current.video;
    const position = previous?.didPlay ? previous.position.position : previous?.startPosition ?? initial.current.startPosition;
    if (previous) { void finish(previous); buffer.retain([]); }
    begin(buffer.prepare(target, position), previous?.server);
  }, [attempt, buffer]);

  const present = () => {
    if (!modalShown.current || !ready || !active || closing.current || failure.current || activating.current === active) return;
    activating.current = active;
    const current = () => alive.current && !closing.current && !failure.current && session.current?.entry === active;
    void (async () => {
      if (!fullscreen.current) {
        // tvOS presents AVKit's fullscreen controller. Android plays inline in
        // this full-window Modal: launching expo-video's separate fullscreen
        // activity from inside a Modal exits at once and closed the player.
        if (presentsNativeFullscreen) {
          fullscreen.current = true;
          await view.current?.enterFullscreen();
          if (!current()) return;
        }
        setPresented(true);
      }
      // An inline expo VideoView is not a child view controller on tvOS;
      // AVKit becomes discoverable only after the first presentation.
      if (!await waitForPlayerAttachment(() => isPlayerAttached(active.player), current)) return;
      const started = await buffer.play(active);
      if (started && current()) endTransition();
    })().catch((cause) => { if (current()) fail("playbackError", "present", cause); })
      .finally(() => { if (activating.current === active) activating.current = null; });
  };
  useEffect(() => { present(); }, [active, ready]);
  // The inline and window players have no Modal to show; they are on screen as soon as they mount.
  useEffect(() => {
    if ((presentation !== "inline" && !windowed) || modalShown.current) return;
    modalShown.current = true;
    setModalVisible(true);
    present();
  }, [presentation, windowed]);
  const requestClose = () => {
    // Phones: Back leaves fullscreen for the details page.
    if (props.onToggleFullscreen) props.onToggleFullscreen();
    else if (dockable && presented && !error) props.onDock?.();
    else if (fullscreen.current) void exitPresentation(); else void close();
  };
  // The Modal takes Back itself on Android; the window player listens for it.
  useTvModalBack(!presented || windowVisible, () => {
    if (windowVisible) requestClose();
    else if (fullscreen.current) void exitPresentation(); else void close();
  }, true);
  useEffect(() => {
    if (!windowVisible) return;
    setPhoneImmersive(true);
    return () => setPhoneImmersive(false);
  }, [windowVisible]);

  useEffect(() => {
    if (!active) return;
    const player = active.player;
    setRate(player.playbackRate);
    setTrackHeight(player.videoTrack?.size.height ?? null);
    // One notification, for the player being watched; Shorts neighbours stay silent.
    if (playsInBackground) player.showNowPlayingNotification = true;
    const subscriptions = [
      player.addListener("playbackRateChange", ({ playbackRate }) => setRate(playbackRate)),
      player.addListener("videoTrackChange", ({ videoTrack }) => setTrackHeight(videoTrack?.size.height ?? null)),
      player.addListener("playingChange", ({ isPlaying }) => {
        setPlaying(isPlaying);
        if (!ownsSpeedControl) return;
        // Paused, the buttons stay until a tap hides them; playing again, they hide a few seconds later.
        clearTimeout(speedButtonTimer.current);
        if (!isPlaying) showSpeedButton(true);
        else if (speedButtonShown.current) speedButtonTimer.current = setTimeout(() => showSpeedButton(false), speedButtonTimeout);
      }),
      player.addListener("timeUpdate", ({ currentTime }) => {
        const current = session.current;
        if (!current || current.entry !== active || current.finished || failure.current) return;
        if (player.playing && currentTime > 0) {
          if (!current.didPlay) void reportPlaybackDiagnostic(player, "playing");
          current.didPlay = true;
          if ((!incognito || isChild) && !current.history) current.history = api.recordPlayback(active.video.video_id, latest.current.queueContext).then(() => false, () => true);
        }
        // A reloading source reports 0 before it seeks back.
        if (!(currentTime > 0) && current.position.position > 0) return;
        current.position = { position: currentTime, duration: player.duration };
        if (!current.didPlay || !current.tracked || !validPlaybackPosition(current.position)) return;
        localProgress.record(active.video.video_id, current.position, false, current.server);
        const now = Date.now();
        if (player.playing && now - current.lastBeat >= heartbeatInterval) {
          current.lastBeat = now;
          current.progress.update(current.position);
        }
      }),
      player.addListener("playingChange", ({ isPlaying }) => {
        const current = session.current;
        if (current?.entry !== active || isPlaying || !current.didPlay || current.finished || failure.current) return;
        current.progress.update(current.position);
        if (current.tracked) localProgress.record(active.video.video_id, current.position, true, current.server);
      }),
      player.addListener("playToEnd", () => {
        const current = session.current;
        if (!current || current.entry !== active || current.finished || switching.current) return;
        // Android's ExoPlayer reports "ended" while still empty, before the
        // source loads. Only a player that played or knows its length can end.
        if (!current.didPlay && !(player.duration > 0)) return;
        current.completed = active.video.live_status !== "live";
        // A sleep timer set to the end of the video stops here instead of playing the next one.
        const stopsHere = sleepTimer().kind === "end";
        if (stopsHere) setSleepTimer("off");
        const next = latest.current.advanceOnEnd && !stopsHere ? latest.current.nextVideo : null;
        if (next) void advance(next);
        else if (fullscreen.current) void exitPresentation(); else void close();
      }),
    ];
    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
      if (playsInBackground) player.showNowPlayingNotification = false;
    };
  }, [active, api, incognito, isChild]);

  useEffect(() => {
    const subscription = subscribePlayerQueue(({ currentId, videoId, action }) => {
      if (currentId !== session.current?.entry.video.video_id || closing.current || switching.current || failure.current) return;
      if (action === "details") { showDetails.current = true; void exitPresentation(); return; }
      const state = latest.current;
      const target = [...state.queueVideos, state.nextVideo, state.previousVideo].find((item) => item?.video_id === videoId);
      if (target) void advance(target);
    });
    return () => subscription.remove();
  }, [buffer]);

  useEffect(() => {
    if (!active || !ready || !presented || queueLoading || switchingVideo || switching.current || session.current?.entry !== active) return;
    const neighbours = active.video.is_short === 1 ? [nextVideo, previousVideo].filter((item): item is Video => item?.is_short === 1 && item.video_id !== active.video.video_id) : [];
    buffer.retain([active.video.video_id, ...neighbours.map((item) => item.video_id)]);
    neighbours.forEach((item) => buffer.prepare(item));
  }, [active, buffer, nextVideo, previousVideo, presented, queueLoading, ready, switchingVideo]);

  useEffect(() => {
    if (!presented || !active) return;
    let valid = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const queue = {
      currentId: active.video.video_id, nextId: nextVideo?.video_id ?? "", previousId: previousVideo?.video_id ?? "",
      navigationEnabled: ready && !switchingVideo && !queueLoading,
      shorts: shortsNavigation(active.video, nextVideo, previousVideo),
      items: queueVideos.map((item) => ({ id: item.video_id, title: item.title })),
      labels: { details: t("videoDetails"), queue: t("playQueue"), next: t("nextVideo"), previous: t("previousVideo") },
    };
    const install = async (remaining: number) => {
      const installed = await updatePlayerQueue(active.player, queue).catch(() => false);
      if (valid && !installed && remaining > 0) retry = setTimeout(() => void install(remaining - 1), 100);
    };
    void install(20);
    return () => { valid = false; clearTimeout(retry); };
  }, [active, nextVideo, presented, previousVideo, queueVideos, queueLoading, ready, switchingVideo, t]);

  useEffect(() => {
    let checking = false;
    const interval = setInterval(() => {
      const current = session.current;
      if (!current || closing.current || failure.current) return;
      if (isChild && !checking) {
        checking = true;
        void api.playbackRestriction().then((status) => { if (alive.current && status.locked) fail("playbackRestricted"); })
          .catch((cause) => fail("playbackRestricted", "restriction", cause)).finally(() => { checking = false; });
      }
    }, 5000);
    const state = AppState.addEventListener("change", (value) => {
      const current = session.current;
      // A ticket that lapsed while away is replaced now, so Play works at once.
      if (value === "active" && current && !failure.current) current.entry.refresh();
      if (value === "background" && current) {
        if (!playsInBackground) void buffer.pause().catch(() => {});
        if (current.didPlay && !current.finished && !failure.current) {
          current.progress.update(current.position);
          // Android may end a background app without warning.
          if (current.tracked) localProgress.record(current.entry.video.video_id, current.position, true, current.server);
        }
        buffer.retain([current.entry.video.video_id]);
      }
    });
    return () => { clearInterval(interval); state.remove(); };
  }, [api, buffer, isChild]);
  // Closing the picture-in-picture window stops the video; it would otherwise play on unseen.
  // A viewer's pause, not buffer.pause(): that releases the video, and Play would be silenced.
  useEffect(() => onPictureInPictureDismiss(() => {
    if (session.current && !closing.current) session.current.entry.player.pause();
  }), []);

  useEffect(() => {
    // When the item is ready, the earlier present effect is handing focus to
    // AVKit in this same commit. Stop any loading-panel focus retries instead
    // of competing with the native fullscreen controller.
    if (!modalVisible || (presented && !error) || dismissing || (!error && active && ready)) return;
    const target = error && error !== "playbackRestricted" ? retryButton.current : detailsButton.current;
    if (target) return focusWhenReady(target, () => setPanelFocused(true));
  }, [active, dismissing, error, modalVisible, presented, ready]);

  // The screen stays on while a video plays in the app; in the background it sleeps as usual.
  useKeepScreenAwake(playing && !dismissing);
  const showNotice = (text: string) => {
    setSkippedNotice(text);
    clearTimeout(skippedNoticeTimer.current);
    skippedNoticeTimer.current = setTimeout(() => setSkippedNotice(null), skippedNoticeTimeout);
  };
  useSponsorBlock({ api, player: active?.player ?? null, video: active?.video ?? null,
    categories: sponsorCategories(props.settings?.sponsorblock_enabled, props.settings?.sponsorblock_categories),
    record: !incognito, onSkip: (seconds) => showNotice(t("sponsorSkipped").replace("{seconds}", String(Math.max(1, Math.round(seconds))))) });
  const sleep = useSleepTimer(ownsSpeedControl ? active?.player ?? null : null, () => showNotice(t("sleepTimerStopped")));
  const sleepLabel = sleep.remaining !== null ? sleepCountdownLabel(sleep.remaining) : sleep.timer.kind === "end" ? t("sleepTimerEndOfVideo") : null;
  // With "remember speed changes" on, a speed picked here outlasts this video.
  const rememberSpeed = (entry: BufferedPlayback, value: string) => {
    const state = latest.current;
    const target = speedMemoryTarget(state.settings?.player_speed_remember, entry.video.channel_playback_speed, entry.video.live_status === "live");
    const channelId = entry.video.channel_id;
    if (target === "channel" && channelId) {
      entry.video = { ...entry.video, channel_playback_speed: value };
      void api.setChannelSpeed(channelId, value).catch(() => {});
    } else if (target === "default") {
      void api.updateSettings({ player_speed: value }).catch(() => {});
      state.onSettingsChange?.({ player_speed: value });
    }
  };

  const currentVideo = active?.video ?? video;
  const inline = presentation === "inline";
  const showButtons = presented && !dismissing && speedButton;
  const qualityLabels = { auto: t("qualityAuto"), fast: t("qualityFast") };
  const qualityLabel = qualityButtonLabel(quality, trackHeight, qualityLabels);
  const surface = <>
    <View style={styles.video}>
    {/* A tap shows or hides ExoPlayer's controls; the app's buttons follow it. The
        buttons sit outside this view, so pressing them doesn't count as a tap. */}
    <View style={styles.video} onTouchStart={({ nativeEvent }) => { touchStart.current = { x: nativeEvent.pageX, y: nativeEvent.pageY, time: Date.now() }; }}
      onTouchEnd={({ nativeEvent }) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (start && Date.now() - start.time < tapDuration && Math.hypot(nativeEvent.pageX - start.x, nativeEvent.pageY - start.y) < tapSlop) toggleSpeedButton();
      }}>
    <VideoView ref={view} player={active?.player ?? null} style={styles.video} nativeControls contentFit="contain"
      fullscreenOptions={{ enable: presentsNativeFullscreen }} allowsPictureInPicture={false}
      // Leaving the app while a video plays floats it over other apps; a paused one stays behind.
      startsPictureInPictureAutomatically={leavesIntoPictureInPicture && playing && presented && !error && !dismissing}
      buttonOptions={ownsSpeedControl ? { showSettings: false } : undefined}
      onFullscreenExit={() => {
        // On Android, leaving a fullscreen the viewer chose returns to the inline player.
        if (!presentsNativeFullscreen) return;
        fullscreen.current = false;
        setPresented(false);
        if (!failure.current) void close();
      }} />
    </View>
    {ownsSpeedControl && presented && !error && !dismissing ? <PlaybackWaitOverlay entry={active} t={t} /> : null}
    {skippedNotice && presented ? <View pointerEvents="none" style={[styles.skippedNotice, inline && !props.fullscreenActive && styles.inlineSkippedNotice]}>
      <Text style={styles.skippedNoticeText}>{skippedNotice}</Text>
    </View> : null}
    {ownsSpeedControl && showButtons ? <View style={[styles.playerButtons, inline && !props.fullscreenActive && styles.inlineButtons]}>
      {currentVideo.live_status !== "live" ? <Pressable accessibilityRole="button" accessibilityLabel={`${t("streamQuality")}: ${qualityLabel}`} hitSlop={12}
        style={({ pressed }) => [styles.speedButton, pressed && styles.speedButtonPressed]}
        onPress={() => { clearTimeout(speedButtonTimer.current); setQualitySheet(true); }}>
        <Text style={styles.speedButtonText}>{qualityLabel}</Text>
      </Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`${t("playbackSpeed")}: ${speedLabel(rate)}`} hitSlop={12}
        style={({ pressed }) => [styles.speedButton, pressed && styles.speedButtonPressed]}
        onPress={() => { clearTimeout(speedButtonTimer.current); setSpeedSheet(true); }}>
        <Text style={styles.speedButtonText}>{speedLabel(rate)}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t("sleepTimer")}: ${sleepLabel ?? t("sleepTimerOff")}`} hitSlop={12}
        style={({ pressed }) => [styles.speedButton, styles.sleepButton, pressed && styles.speedButtonPressed]}
        onPress={() => { clearTimeout(speedButtonTimer.current); setSleepSheet(true); }}>
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path stroke={colors.text} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill={sleepLabel ? colors.text : "none"}
            d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </Svg>
        {sleepLabel ? <Text style={styles.speedButtonText}>{sleepLabel}</Text> : null}
      </Pressable>
      {props.onToggleFullscreen ? <Pressable accessibilityRole="button" accessibilityLabel={t(props.fullscreenActive ? "exitFullscreen" : "enterFullscreen")} hitSlop={12}
        style={({ pressed }) => [styles.speedButton, pressed && styles.speedButtonPressed]} onPress={props.onToggleFullscreen}>
        <Svg width={20} height={20} viewBox="0 0 24 24">
          <Path stroke={colors.text} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none"
            d={props.fullscreenActive ? "M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" : "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"} />
        </Svg>
      </Pressable> : null}
    </View> : null}
    </View>
  </>;
  const speedChoice = speedSheet && active ? <TvChoiceSheet title={t("playbackSpeed")} t={t} value={String(Math.round(rate * 100) / 100)}
    options={speedOptions(rate).map((value) => ({ value, label: speedLabel(value) }))}
    onSelect={(value) => { active.player.playbackRate = Number(value); setRate(Number(value)); setSpeedSheet(false); revealSpeedButton(); rememberSpeed(active, value); }}
    onClose={() => { setSpeedSheet(false); revealSpeedButton(); }} /> : qualitySheet && active ? <TvChoiceSheet title={t("streamQuality")} t={t} value={quality}
    options={STREAM_QUALITIES.map((value) => {
      const label = qualityChoiceLabel(value, qualityLabels);
      // "Auto" and "Fast start" name no height: show the one playing beside the current choice.
      const playing = (value === "auto" || value === "fast") && value === quality ? heightLabel(trackHeight) : null;
      return { value, label: playing ? `${label} (${playing})` : label };
    })}
    onSelect={(value) => {
      setQualitySheet(false);
      revealSpeedButton();
      const next = value as StreamQuality;
      if (next === quality) return;
      // Remembered on this device; the stream reloads where it is.
      setQuality(next);
      void saveStreamQuality(deviceStore, next).catch(() => {});
      active.reload();
    }}
    onClose={() => { setQualitySheet(false); revealSpeedButton(); }} /> : sleepSheet ? <TvChoiceSheet<SleepTimerChoice> title={t("sleepTimer")} t={t}
    value={sleepTimerChoice(sleep.timer)}
    options={SLEEP_TIMER_CHOICES.map((value) => ({ value, label: value === "off" ? t("sleepTimerOff") : value === "end" ? t("sleepTimerEndOfVideo")
      : t("sleepTimerMinutes").replace("{count}", value) }))}
    onSelect={(value) => { setSleepTimer(value); setSleepSheet(false); revealSpeedButton(); }}
    onClose={() => { setSleepSheet(false); revealSpeedButton(); }} /> : null;

  // Phones: the player drawn in the details page, above its title and actions.
  if (inline && !docked) return <View style={styles.inline}>
    {surface}
    {speedChoice}
    {/* A failure mid-video leaves the player presented: show the message and retry over it. */}
    {(!presented || error) && !dismissing ? <View style={styles.inlinePanel}>
      {error ? <>
        <Text style={styles.inlineError}>{t(error)}</Text>
        {error !== "playbackRestricted" ? <Pressable accessibilityRole="button" style={styles.inlineRetry} onPress={() => { switching.current = false; setAttempt((value) => value + 1); }}>
          <Text style={styles.speedButtonText}>{t("tryAgain")}</Text>
        </Pressable> : null}
      </> : <ActivityIndicator color={colors.text} size="large" accessibilityLabel={t("preparingPlayback")} />}
    </View> : null}
  </View>;

  const fullWindow = <SafeAreaProvider>
      <TvFocusScope style={styles.screen}>
        {/* Android draws this edge to edge; keep the controls clear of any system bars showing. */}
        <SafeAreaView edges={playerSafeEdges} style={styles.video}>{surface}</SafeAreaView>
        {speedChoice}
        {(!presented || error) && !dismissing ? <View style={styles.panel}>
          {!error ? <TvLoadingMark accessibilityLabel={t("preparingPlayback")} size={48} /> : null}
          <Text style={styles.eyebrow}>{error ? t("playbackErrorTitle") : t("preparingPlayback")}</Text>
          <Text accessibilityRole="header" numberOfLines={3} style={styles.title}>{currentVideo.title}</Text>
          <Text style={styles.description}>{error ? t(error) : currentVideo.channel_title}</Text>
          <View style={styles.actions}>
            <TvBackButton t={t} focusable={panelFocused} onPress={() => void close()} />
            <TvButton ref={detailsButton} deferPress label={t("videoDetails")} preferredFocus={!error || error === "playbackRestricted"} onFocus={() => setPanelFocused(true)} onPress={() => { showDetails.current = true; void close(); }} />
            {error && error !== "playbackRestricted" ? <TvButton ref={retryButton} label={t("tryAgain")} preferredFocus variant="primary" onPress={() => { switching.current = false; setAttempt((value) => value + 1); }} /> : null}
          </View>
        </View> : null}
      </TvFocusScope>
      </SafeAreaProvider>;
  if (windowed) return <PlayerWindow slot={playerWindowSlot} visible={windowVisible}>{fullWindow}</PlayerWindow>;
  return (
    <Modal visible={!docked && !inline} animationType="none" supportedOrientations={["portrait", "landscape"]}
      onShow={() => { modalShown.current = true; setModalVisible(true); if (!presented) present(); }} onRequestClose={requestClose}>
      {fullWindow}
    </Modal>
  );
}

/** Puts the window player in the slot above the app while it is visible, refreshed on every render. */
function PlayerWindow({ slot, visible, children }: { slot: (node: ReactNode) => void; visible: boolean; children: ReactNode }) {
  useEffect(() => { if (visible) slot(children); });
  useEffect(() => {
    if (!visible) return;
    return () => slot(null);
  }, [slot, visible]);
  return null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  video: { flex: 1 },
  panel: { ...StyleSheet.absoluteFill, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: screenPadding, gap: 20 },
  eyebrow: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "600" },
  title: { maxWidth: 1060, textAlign: "center", color: colors.text, fontSize: 38, lineHeight: 48, fontWeight: "700" },
  description: { maxWidth: 960, color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: 32, textAlign: "center" },
  actions: { flexDirection: "row", gap: 20, marginTop: 16 },
  playerButtons: { position: "absolute", top: 16, right: 16, flexDirection: "row", gap: 10 },
  inlineButtons: { top: 8, right: 8 },
  skippedNotice: { position: "absolute", top: 16, left: 16, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: "rgba(0, 0, 0, 0.6)" },
  inlineSkippedNotice: { top: 8, left: 8 },
  skippedNoticeText: { color: colors.text, fontSize: 14, lineHeight: 18, fontWeight: "600" },
  inline: { flex: 1, backgroundColor: colors.black },
  inlinePanel: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 12, padding: 16, backgroundColor: colors.black },
  inlineError: { color: colors.text, fontSize: 14, textAlign: "center" },
  inlineRetry: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)" },
  speedButton: { minWidth: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18,
    backgroundColor: "rgba(0, 0, 0, 0.6)" },
  sleepButton: { flexDirection: "row", gap: 6 },
  speedButtonPressed: { backgroundColor: "rgba(255, 255, 255, 0.25)" },
  speedButtonText: { color: colors.text, fontSize: 16, lineHeight: 20, fontWeight: "700" },
});
