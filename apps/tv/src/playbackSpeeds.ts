/** Speeds offered by the app's own speed menu (Android's native menu stops at 2×). */
export const PLAYBACK_SPEEDS = ["0.25", "0.5", "0.75", "1", "1.25", "1.5", "1.75", "2", "2.25", "2.5", "2.75", "3", "3.5", "4"] as const;

/** The server accepts channel speeds from 0.1× to 4×. */
export function playableSpeed(value: unknown): number | null {
  const speed = Number(value);
  return Number.isFinite(speed) && speed >= 0.1 && speed <= 4 ? speed : null;
}

/** The menu entry for the current rate, adding it when it is not a listed speed. */
export function speedOptions(current: number): string[] {
  const value = String(Math.round(current * 100) / 100);
  const speeds: string[] = [...PLAYBACK_SPEEDS];
  if (!speeds.includes(value)) speeds.push(value);
  return speeds.sort((left, right) => Number(left) - Number(right));
}

export function speedLabel(speed: number | string): string {
  return `${Math.round(Number(speed) * 100) / 100}×`;
}

/**
 * Where a speed chosen in the player is kept when the profile remembers speed
 * changes: the channel's own speed when it has one, otherwise the profile default.
 */
export function speedMemoryTarget(remember: unknown, channelSpeed: string | null | undefined, live: boolean): "channel" | "default" | null {
  if (remember !== "1" || live) return null;
  return channelSpeed != null && channelSpeed !== "" ? "channel" : "default";
}
