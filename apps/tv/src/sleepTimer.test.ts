import { afterEach, describe, expect, test } from "bun:test";
import { onSleepTimerChange, setSleepTimer, sleepCountdownLabel, sleepTimer, sleepTimerChoice, sleepTimerRemaining, sleepTimerVolume, SLEEP_TIMER_CHOICES } from "./sleepTimer";

afterEach(() => setSleepTimer("off"));

describe("sleep timer", () => {
  test("offers off, a range of minutes and the end of the video", () => {
    expect(SLEEP_TIMER_CHOICES).toEqual(["off", "5", "10", "15", "30", "45", "60", "90", "end"]);
  });

  test("a timed choice counts down from when it was set", () => {
    setSleepTimer("15", 1_000);
    expect(sleepTimer()).toEqual({ kind: "time", minutes: 15, deadline: 1_000 + 15 * 60_000 });
    expect(sleepTimerChoice(sleepTimer())).toBe("15");
    expect(sleepTimerRemaining(sleepTimer(), 1_000)).toBe(900);
    expect(sleepTimerRemaining(sleepTimer(), 1_000 + 60_500)).toBe(840);
    expect(sleepTimerRemaining(sleepTimer(), 1_000 + 20 * 60_000)).toBe(0);
  });

  test("end of video and off have no countdown", () => {
    setSleepTimer("end");
    expect(sleepTimer()).toEqual({ kind: "end" });
    expect(sleepTimerRemaining(sleepTimer())).toBeNull();
    setSleepTimer("off");
    expect(sleepTimerChoice(sleepTimer())).toBe("off");
    expect(sleepTimerRemaining(sleepTimer())).toBeNull();
  });

  test("tells listeners about every change until they unsubscribe", () => {
    let calls = 0;
    const stop = onSleepTimerChange(() => { calls += 1; });
    setSleepTimer("5");
    setSleepTimer("off");
    stop();
    setSleepTimer("end");
    expect(calls).toBe(2);
  });

  test("eases the volume down over the last ten seconds", () => {
    setSleepTimer("5", 0);
    const deadline = 5 * 60_000;
    expect(sleepTimerVolume(sleepTimer(), deadline - 30_000)).toBe(1);
    expect(sleepTimerVolume(sleepTimer(), deadline - 5_000)).toBe(0.5);
    expect(sleepTimerVolume(sleepTimer(), deadline)).toBe(0.1);
    expect(sleepTimerVolume({ kind: "end" })).toBe(1);
  });

  test("labels the time left in minutes, or hours past an hour", () => {
    expect(sleepCountdownLabel(899)).toBe("14:59");
    expect(sleepCountdownLabel(5)).toBe("0:05");
    expect(sleepCountdownLabel(5399)).toBe("1:29:59");
  });
});
