/**
 * The player's sleep timer: after a set time, or at the end of the video playing,
 * playback stops. It belongs to the app, not to one player, so it carries on when
 * the next video opens a new player. It is transient: nothing is saved.
 */
export type SleepTimer = { kind: "off" } | { kind: "time"; minutes: number; deadline: number } | { kind: "end" };
export type SleepTimerChoice = "off" | "end" | `${number}`;

export const SLEEP_TIMER_MINUTES = [5, 10, 15, 30, 45, 60, 90] as const;
export const SLEEP_TIMER_CHOICES: readonly SleepTimerChoice[] = ["off", ...SLEEP_TIMER_MINUTES.map((minutes) => `${minutes}` as const), "end"];
/** The volume eases down over this many seconds before the timer stops playback. */
export const SLEEP_FADE_SECONDS = 10;

let state: SleepTimer = { kind: "off" };
const listeners = new Set<() => void>();

export function sleepTimer(): SleepTimer { return state; }

export function setSleepTimer(choice: SleepTimerChoice, now = Date.now()) {
  const minutes = Number(choice);
  state = choice === "end" ? { kind: "end" }
    : Number.isFinite(minutes) && minutes > 0 ? { kind: "time", minutes, deadline: now + minutes * 60_000 } : { kind: "off" };
  listeners.forEach((listener) => listener());
}

export function onSleepTimerChange(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The choice the timer was set with, to mark it in the list. */
export function sleepTimerChoice(timer: SleepTimer): SleepTimerChoice {
  return timer.kind === "time" ? `${timer.minutes}` : timer.kind;
}

/** Whole seconds left on a timed timer; null for "off" and "end of video". */
export function sleepTimerRemaining(timer: SleepTimer, now = Date.now()): number | null {
  return timer.kind === "time" ? Math.max(0, Math.ceil((timer.deadline - now) / 1000)) : null;
}

/** The player's volume as the timer runs out: full until the last few seconds, then easing towards silence. */
export function sleepTimerVolume(timer: SleepTimer, now = Date.now()) {
  if (timer.kind !== "time") return 1;
  const left = (timer.deadline - now) / 1000;
  return left >= SLEEP_FADE_SECONDS ? 1 : Math.max(0.1, left / SLEEP_FADE_SECONDS);
}

/** "14:05" or "1:29:59": the time left, as the button shows it. */
export function sleepCountdownLabel(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
