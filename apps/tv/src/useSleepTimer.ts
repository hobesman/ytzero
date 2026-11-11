import { useEffect, useRef, useState } from "react";
import type { VideoPlayer } from "expo-video";
import { onSleepTimerChange, setSleepTimer, sleepTimer, sleepTimerRemaining, sleepTimerVolume } from "./sleepTimer";

/**
 * Runs the sleep timer against the player playing now: the volume eases down at
 * the end, then the video pauses. Android stops the app's timers in the
 * background but not the player's time updates, so both check the clock.
 * Returns the timer and its seconds left, refreshed every second.
 */
export function useSleepTimer(player: VideoPlayer | null, onStop: () => void) {
  const [timer, setTimer] = useState(sleepTimer);
  const [now, setNow] = useState(Date.now);
  const faded = useRef<VideoPlayer | null>(null);
  const stopped = useRef(onStop);
  stopped.current = onStop;
  useEffect(() => onSleepTimerChange(() => { setTimer(sleepTimer()); setNow(Date.now()); }), []);

  useEffect(() => {
    const restore = () => {
      if (faded.current) faded.current.volume = 1;
      faded.current = null;
    };
    if (!player || timer.kind !== "time") { restore(); return; }
    const check = () => {
      const time = Date.now();
      const current = sleepTimer();
      if (current.kind !== "time") return;
      if (time >= current.deadline) {
        const wasPlaying = player.playing;
        setSleepTimer("off");
        if (wasPlaying) { player.pause(); stopped.current(); }
        restore();
        return;
      }
      const volume = sleepTimerVolume(current, time);
      if (volume < 1 && player.playing) { player.volume = volume; faded.current = player; }
    };
    const tick = setInterval(() => { setNow(Date.now()); check(); }, 1000);
    const updates = player.addListener("timeUpdate", check);
    check();
    return () => { clearInterval(tick); updates.remove(); restore(); };
  }, [player, timer]);

  return { timer, remaining: sleepTimerRemaining(timer, now) };
}
