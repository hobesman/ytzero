import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking } from "react-native";
import { loadMusicMode, saveMusicMode } from "../devicePreferences";
import { deviceStore } from "../deviceStore";
import { musicPlayer } from "../musicPlayer";
import { MusicApi } from "./musicApi";
import { MusicSession } from "./musicSession";

/** The app-icon shortcut and the music notification open the app with this link. */
export const MUSIC_LINK = "ytzero://music";
export const isMusicLink = (url: string | null | undefined) => Boolean(url && /^ytzero:\/\/music\/?(?:[?#].*)?$/i.test(url));

type Options = {
  /** Phone layout on a device with the music player. */
  available: boolean;
  instanceUrl: string; accessToken?: string;
  profileId: number | undefined;
  /** Child profiles have no music mode. */
  isChild: boolean;
};

/**
 * Which mode the phone app shows, and the music station for the signed-in
 * profile. Leaving music mode, switching profile or signing out ends the
 * station, so music never carries over into video or another profile.
 */
export function useMusicMode({ available, instanceUrl, accessToken, profileId, isChild }: Options) {
  const [chosen, setChosen] = useState(false);
  const allowed = available && musicPlayer.available && !isChild && profileId !== undefined && Boolean(accessToken);
  const music = allowed && chosen;

  useEffect(() => {
    if (!available) return;
    let active = true;
    void loadMusicMode(deviceStore).then((value) => { if (active && value) setChosen(true); }, () => {});
    const open = (url: string | null) => { if (active && isMusicLink(url)) setChosen(true); };
    void Linking.getInitialURL().then(open, () => {});
    const subscription = Linking.addEventListener("url", (event) => open(event.url));
    return () => { active = false; subscription.remove(); };
  }, [available]);

  const musicApi = useMemo(() => allowed ? new MusicApi(instanceUrl, accessToken) : null, [accessToken, allowed, instanceUrl]);
  const [session, setSession] = useState<MusicSession | null>(null);
  useEffect(() => {
    if (!musicApi || !music) { setSession(null); return; }
    const created = new MusicSession(musicApi);
    setSession(created);
    return () => { void created.stop().finally(() => created.dispose()); };
  }, [music, musicApi, profileId]);

  const setMusic = useCallback((value: boolean) => {
    setChosen(value);
    void saveMusicMode(deviceStore, value).catch(() => {});
  }, []);

  return { music, canUseMusic: allowed, setMusic, musicApi, session };
}
