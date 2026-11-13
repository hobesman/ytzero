/** A song handed to the native music player. `url` is the server's audio address. */
export type MusicPlayerTrack = {
  videoId: string;
  url: string;
  title: string;
  artist: string;
  album?: string | null;
  artwork?: string | null;
};

/** How far a song got when the player moved off it. */
export type MusicPlayerProgress = { videoId: string; position: number; duration: number };

export type MusicTrackChange = {
  index: number;
  videoId: string | null;
  /** "auto": the previous song finished; "seek": the listener skipped; "playlist": the queue was replaced. */
  reason: "auto" | "seek" | "repeat" | "playlist";
  previous: MusicPlayerProgress | null;
};

export type MusicPlayerState = {
  index: number;
  videoId: string | null;
  count: number;
  position: number;
  duration: number | null;
  playing: boolean;
  buffering: boolean;
  ended: boolean;
};

export type MusicPlayerError = { videoId: string | null; message: string };

export type Unsubscribe = () => void;

export type MusicPlayer = {
  available: boolean;
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
  /** Ends music and returns how far the last song got. */
  stop(): Promise<MusicPlayerProgress | null>;
  /** Pause at `deadline` (ms since the epoch, 0 for none), or when the current song ends. */
  setSleepTimer(deadline: number, endOfSong: boolean): Promise<void>;
  onTrackChange(listener: (event: MusicTrackChange) => void): Unsubscribe;
  onStateChange(listener: (event: MusicPlayerState) => void): Unsubscribe;
  onError(listener: (event: MusicPlayerError) => void): Unsubscribe;
  onSleep(listener: () => void): Unsubscribe;
};
