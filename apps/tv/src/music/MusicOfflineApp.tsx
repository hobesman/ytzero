import { useEffect, useMemo, useState } from "react";
import type { YtZeroApi } from "../api";
import { TvButton } from "../components/TvButton";
import type { Translate } from "../i18n";
import { musicPlayer } from "../musicPlayer";
import type { PhoneProfiles } from "../phone/PhoneAccountSheet";
import { savedProfileStore } from "../storage";
import type { Profile } from "../types";
import { MusicApp } from "./MusicApp";
import type { MusicDownloadsView } from "./musicDownloads";
import { OfflineMusicApi } from "./musicOfflineApi";
import { MusicSession } from "./musicSession";
import { musicDownloads, useMusicDownloads } from "./useMusicDownloads";

/** The profile id of the music shown offline, when it was saved on this instance. */
function offlineProfileId(view: MusicDownloadsView, instanceUrl: string): number | null {
  const owner = view.index.lastOwner;
  const prefix = `${instanceUrl.replace(/\/+$/, "")}#`;
  if (!owner?.startsWith(prefix)) return null;
  const id = Number(owner.slice(prefix.length));
  return Number.isSafeInteger(id) ? id : null;
}

function offlineSongCount(view: MusicDownloadsView, instanceUrl: string): number {
  if (!view.available || offlineProfileId(view, instanceUrl) === null) return 0;
  return view.index.tracks.filter((item) => item.owner === view.index.lastOwner && item.state === "done").length;
}

/** On the "couldn't load" screen: plays the music downloaded by the last profile signed in here. */
export function MusicOfflineButton({ instanceUrl, t, onPress }: { instanceUrl: string; t: Translate; onPress: () => void }) {
  const view = useMusicDownloads();
  const count = musicPlayer.available ? offlineSongCount(view, instanceUrl) : 0;
  return count ? <TvButton deferPress label={t("musicPlayDownloads").replace("{count}", String(count))} variant="ghost" onPress={onPress} /> : null;
}

/**
 * Music mode while the server can't be reached: the last profile's downloads,
 * played from the phone. Listens wait on the phone (never in Incognito mode).
 * Signing out forgets that profile here, so its music doesn't show afterwards.
 */
export function MusicOfflineApp({ api, instanceUrl, t, incognito, onIncognitoChange, onExit }: {
  api: YtZeroApi; instanceUrl: string; t: Translate; incognito: boolean; onIncognitoChange: (value: boolean) => void; onExit: () => void;
}) {
  const view = useMusicDownloads();
  const profileId = offlineProfileId(view, instanceUrl);
  const musicApi = useMemo(() => new OfflineMusicApi(instanceUrl.replace(/\/+$/, ""), undefined, musicDownloads), [instanceUrl]);
  const [session, setSession] = useState<MusicSession | null>(null);
  const [saved, setSaved] = useState<{ name: string; avatar: string; avatarColor: string } | null>(null);
  useEffect(() => {
    const created = new MusicSession(musicApi);
    setSession(created);
    return () => { void created.stop().finally(() => created.dispose()); };
  }, [musicApi]);
  useEffect(() => { session?.setIncognito(incognito); }, [incognito, session]);
  useEffect(() => {
    let active = true;
    void savedProfileStore.list(instanceUrl).then((list) => {
      const entry = list.find((item) => item.profileId === profileId);
      if (active && entry) setSaved({ name: entry.name, avatar: entry.avatar, avatarColor: entry.avatarColor });
    }, () => {});
    return () => { active = false; };
  }, [instanceUrl, profileId]);
  if (profileId === null || !session) return null;
  const profile: Profile = {
    id: profileId, name: saved?.name ?? "", avatar: saved?.avatar ?? "", avatar_color: saved?.avatarColor ?? "#5f6368",
    has_pin: false, active: true, is_child: false, pin_locked: false, can_switch: false,
  };
  const profiles: PhoneProfiles = {
    active: profile, profiles: [profile], canSwitch: false, childLockEnabled: false, incognito, onIncognitoChange,
    onSwitch: async () => { throw new Error("offline"); },
  };
  return <MusicApp api={api} musicApi={musicApi} session={session} t={t} profiles={profiles} onSwitchToVideo={onExit} />;
}
