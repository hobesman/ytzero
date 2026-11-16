import type { MusicPlayer } from "./musicPlayerTypes";

export * from "./musicPlayerTypes";

// Music mode is Android-only; elsewhere the player does nothing and reports itself unavailable.
const noop = async () => {};
const none = () => () => {};

export const musicPlayer: MusicPlayer = {
  available: false,
  setAuthorization: noop,
  setQueue: noop,
  append: noop,
  insertAt: noop,
  move: noop,
  removeAt: noop,
  skipTo: noop,
  play: noop,
  pause: noop,
  next: noop,
  previous: noop,
  seekTo: noop,
  getState: async () => null,
  stop: async () => null,
  setSleepTimer: noop,
  setIncognito: noop,
  setSkips: noop,
  setLoudness: noop,
  setLevelling: noop,
  onTrackChange: none,
  onStateChange: none,
  onError: none,
  onSleep: none,
};
