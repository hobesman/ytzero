/** Brightness and volume as fractions from 0 to 1, for the fullscreen player's edge swipes. */
export type PlayerLevels = {
  brightness(): number;
  setBrightness(level: number): void;
  /** Hands the window's brightness back to the system setting. */
  resetBrightness(): void;
  volume(): number;
  setVolume(level: number): void;
};

/** Android only: elsewhere the swipes aren't offered. */
export const playerLevels: PlayerLevels | null = null;
