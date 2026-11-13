import { useEffect, useState, type ReactNode } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import type { YtZeroApi } from "../api";
import { SidebarIcon } from "../components/SidebarIcon";
import type { Translate } from "../i18n";
import { musicPlayer } from "../musicPlayer";
import { PhoneAccountSheet, PhoneProfileAvatar, type PhoneProfiles } from "../phone/PhoneAccountSheet";
import { phoneColors, phoneMetrics, phoneType } from "../phone/phoneTheme";
import type { MusicApi } from "./musicApi";
import { MusicHomeScreen, MusicLibraryScreen, MusicSearchScreen } from "./MusicBrowseScreens";
import { MusicIcon } from "./MusicIcon";
import { MusicMiniBar, MusicNowPlaying } from "./MusicPlayerViews";
import { current } from "./musicQueue";
import { useMusicSession, type MusicSession } from "./musicSession";

type Tab = "home" | "search" | "library";
const tabKeys: Tab[] = ["home", "search", "library"];

type Props = {
  api: YtZeroApi; musicApi: MusicApi; session: MusicSession; t: Translate; profiles: PhoneProfiles;
  onSwitchToVideo: () => void;
};

/**
 * Music mode: its own tabs, player and account menu. It talks to the server
 * only through `/music/*`, so nothing here reaches video history or feeds.
 */
export function MusicApp({ api, musicApi, session, t, profiles, onSwitchToVideo }: Props) {
  const state = useMusicSession(session);
  const [tab, setTab] = useState<Tab>("home");
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(["home"]));
  const [playerOpen, setPlayerOpen] = useState(false);
  const [account, setAccount] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const playingId = current(state.queue)?.videoId ?? null;

  useEffect(() => {
    if (!state.error) return;
    setNotice(t("musicStartFailed"));
  }, [state.error, t]);
  useEffect(() => musicPlayer.onSleep(() => setNotice(t("musicSleepStopped"))), [t]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  // A newly started station opens the player.
  useEffect(() => { if (state.starting) setPlayerOpen(true); }, [state.starting]);
  useEffect(() => { if (!playingId && !state.starting) setPlayerOpen(false); }, [playingId, state.starting]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (account) { setAccount(false); return true; }
      if (playerOpen) { setPlayerOpen(false); return true; }
      if (tab !== "home") { setTab("home"); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [account, playerOpen, tab]);

  const selectTab = (next: Tab) => {
    setTab(next);
    setVisited((visitedTabs) => visitedTabs.has(next) ? visitedTabs : new Set([...visitedTabs, next]));
  };
  const screen = (key: Tab): ReactNode => {
    const props = { api: musicApi, session, t, visible: key === tab, playingId };
    if (key === "search") return <MusicSearchScreen {...props} />;
    if (key === "library") return <MusicLibraryScreen {...props} />;
    return <MusicHomeScreen {...props} />;
  };
  const title = tab === "search" ? t("musicSearch") : tab === "library" ? t("musicLibrary") : t("musicTitle");
  const tabs: { key: Tab; icon: "home" | "search" | "playlists"; label: string }[] = [
    { key: "home", icon: "home", label: t("musicHome") },
    { key: "search", icon: "search", label: t("musicSearch") },
    { key: "library", icon: "playlists", label: t("musicLibrary") },
  ];

  return <View style={styles.screen}>
    <View style={styles.topBar}>
      <MusicIcon name="note" color={phoneColors.accent} size={26} />
      <Text numberOfLines={1} style={styles.title}>{title}</Text>
      <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel={`${t("account")}: ${profiles.active.name}`} onPress={() => setAccount(true)} style={styles.avatar}>
        <PhoneProfileAvatar api={api} profile={profiles.active} size={30} />
      </Pressable>
    </View>
    <View style={styles.body}>
      {tabKeys.filter((key) => visited.has(key)).map((key) => <View key={key} style={[styles.layer, key !== tab && styles.gone]}>{screen(key)}</View>)}
    </View>
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    <MusicMiniBar api={musicApi} session={session} state={state} t={t} onOpen={() => setPlayerOpen(true)} />
    <View style={styles.tabBar}>
      {tabs.map((item) => {
        const selected = tab === item.key;
        const color = selected ? phoneColors.text : phoneColors.textMuted;
        return <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={item.label} onPress={() => selectTab(item.key)} style={styles.tab}>
          <SidebarIcon name={item.icon} color={color} size={24} />
          <Text numberOfLines={1} style={[styles.tabLabel, { color }]}>{item.label}</Text>
        </Pressable>;
      })}
    </View>
    {playerOpen && playingId ? <View style={styles.overlay}>
      <MusicNowPlaying api={musicApi} session={session} state={state} t={t} onClose={() => setPlayerOpen(false)} />
    </View> : null}
    {account ? <PhoneAccountSheet api={api} profiles={profiles} t={t} onClose={() => setAccount(false)}
      modeSwitch={{ music: true, onPress: onSwitchToVideo }} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: phoneColors.background },
  topBar: { height: phoneMetrics.topBar, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: phoneMetrics.gutter },
  title: { flex: 1, ...phoneType.heading, color: phoneColors.text },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  body: { flex: 1 },
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  gone: { display: "none" },
  notice: { ...phoneType.body, color: phoneColors.text, backgroundColor: phoneColors.surfaceRaised, textAlign: "center", paddingVertical: 10, paddingHorizontal: 16 },
  tabBar: { height: phoneMetrics.tabBar, flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: phoneColors.divider, backgroundColor: phoneColors.background },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingTop: 6 },
  tabLabel: { fontSize: 11.5, fontWeight: "600" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
});
