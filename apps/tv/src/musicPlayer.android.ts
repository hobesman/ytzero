import { NativeModule, requireOptionalNativeModule } from "expo";
import type {
  MusicPlayer,
  MusicPlayerError,
  MusicPlayerProgress,
  MusicPlayerState,
  MusicPlayerTrack,
  MusicTrackChange,
} from "./musicPlayerTypes";

export * from "./musicPlayerTypes";

type Events = {
  onTrackChange: (event: MusicTrackChange) => void;
  onStateChange: (event: MusicPlayerState) => void;
  onError: (event: MusicPlayerError) => void;
  onSleep: () => void;
};

declare class YtZeroMusicPlayerModule extends NativeModule<Events> {
  setAuthorization(token: string | null): Promise<void>;
  setQueue(tracks: MusicPlayerTrack[], startIndex: number, play: boolean): Promise<void>;
  append(tracks: MusicPlayerTrack[]): Promise<void>;
  removeAt(index: number): Promise<void>;
  skipTo(index: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  getState(): Promise<MusicPlayerState | null>;
  stop(): Promise<MusicPlayerProgress | null>;
  setSleepTimer(deadline: number, endOfSong: boolean): Promise<void>;
  /** Parts of a song to jump over, as [start, end] seconds; an empty list clears them. */
  setSkips(videoId: string, segments: [number, number][]): Promise<void>;
}

const native = requireOptionalNativeModule<YtZeroMusicPlayerModule>("YtZeroMusicPlayer");

const noop = async () => {};

function subscribe<K extends keyof Events>(name: K, listener: Events[K]) {
  if (!native) return () => {};
  const subscription = native.addListener(name, listener);
  return () => subscription.remove();
}

function clean(tracks: MusicPlayerTrack[]): MusicPlayerTrack[] {
  // Records reject undefined; send null for the optional fields.
  return tracks.map((track) => ({ ...track, album: track.album ?? null, artwork: track.artwork ?? null }));
}

export const musicPlayer: MusicPlayer = {
  available: native != null,
  setAuthorization: (token) => native?.setAuthorization(token) ?? noop(),
  setQueue: (tracks, startIndex, play) => native?.setQueue(clean(tracks), startIndex, play) ?? noop(),
  append: (tracks) => native?.append(clean(tracks)) ?? noop(),
  removeAt: (index) => native?.removeAt(index) ?? noop(),
  skipTo: (index) => native?.skipTo(index) ?? noop(),
  play: () => native?.play() ?? noop(),
  pause: () => native?.pause() ?? noop(),
  next: () => native?.next() ?? noop(),
  previous: () => native?.previous() ?? noop(),
  seekTo: (seconds) => native?.seekTo(seconds) ?? noop(),
  getState: () => native?.getState() ?? Promise.resolve(null),
  stop: () => native?.stop() ?? Promise.resolve(null),
  setSleepTimer: (deadline, endOfSong) => native?.setSleepTimer(deadline, endOfSong) ?? noop(),
  setSkips: (videoId, segments) => native?.setSkips(videoId, segments) ?? noop(),
  onTrackChange: (listener) => subscribe("onTrackChange", listener),
  onStateChange: (listener) => subscribe("onStateChange", listener),
  onError: (listener) => subscribe("onError", listener),
  onSleep: (listener) => subscribe("onSleep", listener),
};
