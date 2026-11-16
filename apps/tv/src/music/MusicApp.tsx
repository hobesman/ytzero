import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { landscapePlayerWidth, landscapeRailWidth, useLandscapeLayout } from "../landscapeLayout";
import { PhoneSideRail } from "../phone/PhoneSideRail";
import type { YtZeroApi } from "../api";
import { SidebarIcon } from "../components/SidebarIcon";
import type { Translate } from "../i18n";
import { musicPlayer } from "../musicPlayer";
import { PhoneAccountSheet, PhoneProfileAvatar, type PhoneProfiles } from "../phone/PhoneAccountSheet";
import { phoneColors, phoneMetrics, phoneType } from "../phone/phoneTheme";
import type { Language } from "../types";
import type { MusicApi, MusicTrack } from "./musicApi";
import { MusicHomeScreen, MusicLibraryScreen, MusicSearchScreen } from "./MusicBrowseScreens";
import { MusicIcon } from "./MusicIcon";
import { MusicMiniBar, MusicNowPlaying } from "./MusicPlayerViews";
import { MusicGenreScreen, MusicPlaylistScreen } from "./MusicGenreScreens";
import { MusicAlbumScreen, MusicArtistScreen } from "./MusicPages";
import { MusicAddToPlaylistSheet, MusicUserPlaylistScreen, type MusicAppPage } from "./MusicPlaylistScreens";
import { MusicTrackMenuProvider } from "./MusicTrackMenu";
import { current } from "./musicQueue";
import { useMusicSession, type MusicSession } from "./musicSession";

type Tab = "home" | "search" | "library";
const tabKeys: Tab[] = ["home", "search", "library"];

type Props = {
  api: YtZeroApi; musicApi: MusicApi; session: MusicSession; t: Translate; language: Language; profiles: PhoneProfiles;
  onSwitchToVideo: () => void;
};

/**
 * Music mode: its own tabs, player and account menu. It talks to the server
 * only through `/music/*`, so nothing here reaches video history or feeds.
 */
export function MusicApp({ api, musicApi, session, t, language, profiles, onSwitchToVideo }: Props) {
  const state = useMusicSession(session);
  // Landscape: tabs down the side and the player always beside the browse list, never over it.
  const landscape = useLandscapeLayout();
  const window = useWindowDimensions();
  const [tab, setTab] = useState<Tab>("home");
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(["home"]));
  const [playerOpen, setPlayerOpen] = useState(false);
  const [account, setAccount] = useState(false);
  // Album and artist pages opened from the tabs; Back closes the top one.
  const [pages, setPages] = useState<MusicAppPage[]>([]);
  const [adding, setAdding] = useState<MusicTrack | null>(null);
  const openPage = useCallback((page: MusicAppPage) => setPages((open) => [...open.slice(-9), page]), []);
  const closePage = useCallback(() => setPages((open) => open.slice(0, -1)), []);
  const topPage = pages.at(-1) ?? null;
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
      if (adding) { setAdding(null); return true; }
      if (account) { setAccount(false); return true; }
      if (playerOpen && !landscape) { setPlayerOpen(false); return true; }
      if (pages.length) { closePage(); return true; }
      if (tab !== "home") { setTab("home"); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [account, adding, closePage, landscape, pages.length, playerOpen, tab]);

  const selectTab = (next: Tab) => {
    setTab(next);
    setPages([]);
    setVisited((visitedTabs) => visitedTabs.has(next) ? visitedTabs : new Set([...visitedTabs, next]));
  };
  const screen = (key: Tab): ReactNode => {
    const props = { api: musicApi, session, t, language, visible: key === tab && !pages.length, playingId, onOpen: openPage };
    if (key === "search") return <MusicSearchScreen {...props} />;
    if (key === "library") return <MusicLibraryScreen {...props} />;
    return <MusicHomeScreen {...props} />;
  };
  const pageScreen = (page: MusicAppPage): ReactNode => {
    const props = { api: musicApi, session, t, playingId, id: page.id, onOpen: openPage, onBack: closePage };
    if (page.kind === "mine") return <MusicUserPlaylistScreen {...props} language={language} />;
    if (page.kind === "album") return <MusicAlbumScreen {...props} />;
    if (page.kind === "artist") return <MusicArtistScreen {...props} />;
    if (page.kind === "genre") return <MusicGenreScreen {...props} title={page.title} />;
    return <MusicPlaylistScreen {...props} />;
  };
  const title = tab === "search" ? t("musicSearch") : tab === "library" ? t("musicLibrary") : t("musicTitle");
  const tabs: { key: Tab; icon: "home" | "search" | "playlists"; label: string }[] = [
    { key: "home", icon: "home", label: t("musicHome") },
    { key: "search", icon: "search", label: t("musicSearch") },
    { key: "library", icon: "playlists", label: t("musicLibrary") },
  ];

  const avatar = <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel={`${t("account")}: ${profiles.active.name}${profiles.incognito ? `, ${t("incognitoMode")}` : ""}`} onPress={() => setAccount(true)}
    style={[styles.avatar, profiles.incognito && styles.incognitoRing]}>
    <PhoneProfileAvatar api={api} profile={profiles.active} size={30} />
  </Pressable>;
  const body = <View style={styles.body}>
    {tabKeys.filter((key) => visited.has(key)).map((key) => <View key={key} style={[styles.layer, key !== tab && styles.gone]}>{screen(key)}</View>)}
    {topPage ? <View key={`${pages.length}:${topPage.kind}:${topPage.id}`} style={styles.layer}>
      {pageScreen(topPage)}
    </View> : null}
  </View>;
  const noticeBar = notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null;
  const accountSheet = account ? <PhoneAccountSheet api={api} profiles={profiles} t={t} onClose={() => setAccount(false)}
    modeSwitch={{ music: true, onPress: onSwitchToVideo }} /> : null;
  const addSheet = adding ? <MusicAddToPlaylistSheet api={musicApi} t={t} track={adding} onNotice={setNotice} onClose={() => setAdding(null)} /> : null;

  if (landscape) {
    const paneWidth = landscapePlayerWidth(window.width - landscapeRailWidth);
    return <MusicTrackMenuProvider api={musicApi} session={session} t={t} onNotice={setNotice}><View style={[styles.screen, styles.row]}>
      <PhoneSideRail items={tabs} selected={tab} onSelect={selectTab} top={<MusicIcon name="note" color={phoneColors.accent} size={28} />} bottom={avatar} />
      <View style={styles.main}>
        <View style={styles.topBar}><Text numberOfLines={1} style={styles.title}>{title}</Text></View>
        {body}
        {noticeBar}
        {/* Only while a station is starting: once a song plays, it is in the pane. */}
        {!playingId ? <MusicMiniBar api={musicApi} session={session} state={state} t={t} onOpen={() => {}} /> : null}
      </View>
      {playingId ? <View style={[styles.pane, { width: paneWidth }]}>
        <MusicNowPlaying api={musicApi} session={session} state={state} t={t} paneWidth={paneWidth} onClose={() => {}} onAddToPlaylist={setAdding} />
      </View> : null}
      {addSheet}
      {accountSheet}
    </View></MusicTrackMenuProvider>;
  }

  return <MusicTrackMenuProvider api={musicApi} session={session} t={t} onNotice={setNotice}><View style={styles.screen}>
    <View style={styles.topBar}>
      <MusicIcon name="note" color={phoneColors.accent} size={26} />
      <Text numberOfLines={1} style={styles.title}>{title}</Text>
      {avatar}
    </View>
    {body}
    {noticeBar}
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
      <MusicNowPlaying api={musicApi} session={session} state={state} t={t} onClose={() => setPlayerOpen(false)} onAddToPlaylist={setAdding} />
      {notice ? <Text accessibilityLiveRegion="polite" style={[styles.notice, styles.noticeOver]}>{notice}</Text> : null}
    </View> : null}
    {addSheet}
    {accountSheet}
  </View></MusicTrackMenuProvider>;
}

const styles = StyleSheet.create({
  screen: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: phoneColors.background },
  topBar: { height: phoneMetrics.topBar, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: phoneMetrics.gutter },
  title: { flex: 1, ...phoneType.heading, color: phoneColors.text },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  // Incognito is shown as a dashed ring around the avatar, as in video mode.
  incognitoRing: { borderColor: phoneColors.textMuted, borderStyle: "dashed" },
  body: { flex: 1 },
  row: { flexDirection: "row" },
  main: { flex: 1 },
  pane: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: phoneColors.divider },
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  gone: { display: "none" },
  notice: { ...phoneType.body, color: phoneColors.text, backgroundColor: phoneColors.surfaceRaised, textAlign: "center", paddingVertical: 10, paddingHorizontal: 16 },
  tabBar: { height: phoneMetrics.tabBar, flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: phoneColors.divider, backgroundColor: phoneColors.background },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingTop: 6 },
  tabLabel: { fontSize: 11.5, fontWeight: "600" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  noticeOver: { position: "absolute", right: 0, bottom: 0, left: 0 },
});
