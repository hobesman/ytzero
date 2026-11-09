import { useEffect } from "react";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

const tag = "ytzero.player";

/**
 * Keeps the screen from dimming or sleeping while a video plays on screen.
 *
 * It sets the app window's keep-screen-on flag, which only applies while the app
 * is visible: when the viewer turns the screen off or leaves the app, playback
 * carries on in the background and the phone sleeps as usual.
 */
export function useKeepScreenAwake(playing: boolean): void {
  useEffect(() => {
    if (!playing) return;
    void activateKeepAwakeAsync(tag).catch(() => {});
    return () => { void deactivateKeepAwake(tag).catch(() => {}); };
  }, [playing]);
}
