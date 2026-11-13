import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { YtZeroApi } from "../api";
import { LogoMark } from "../components/Logo";
import { useMiniPlayerOffset } from "../components/MiniPlayerHost";
import { SidebarIcon } from "../components/SidebarIcon";
import type { Translate } from "../i18n";
import { resolveTvNavigation, type TvBrowseDestination, type TvNavigationItem } from "../navigation";
import type { OpenVideo } from "../playbackQueue";
import type { Language, Video } from "../types";
import { PhoneAccountSheet, PhoneProfileAvatar, type PhoneProfiles } from "./PhoneAccountSheet";
import { PhoneBookmarksScreen } from "./PhoneBookmarksScreen";
import { PhoneChannelScreen } from "./PhoneChannelScreen";
import { PhoneDownloadsScreen } from "./PhoneDownloadsScreen";
import { phoneDownloads } from "../usePhoneDownloads";
import { PhoneFeedScreen } from "./PhoneFeedScreen";
import { PhoneListRow } from "./PhoneList";
import { PhoneFollowedPlaylistsScreen, PhonePlaylistScreen } from "./PhonePlaylistScreens";
import { PhoneSearchScreen } from "./PhoneSearchScreen";
import { PhoneSettingsScreen, type PhoneSettings } from "./PhoneSettingsScreen";
import { phoneColors, phoneMetrics, phoneType } from "./phoneTheme";

type Tab = "home" | "search" | "live" | "library";
const tabKeys: Tab[] = ["home", "search", "live", "library"];
/** A screen pushed above the tabs; Back pops them in order. */
type Pushed =
  | { kind: "feed"; destination: TvBrowseDestination; title: string }
  | { kind: "settings" }
  | { kind: "bookmarks"; title: string }
  | { kind: "playlists"; title: string }
  | { kind: "playlist"; id: string; title: string }
  | { kind: "channel"; id: string }
  | { kind: "phoneDownloads" };

const libraryDestinations = new Set<string>(["/watchlist", "/followed-playlists", "/downloads", "/liked", "/bookmarks", "/archive", "/recommendations", "/shorts"]);

type Props = {
  api: YtZeroApi; t: Translate; language: Language; hidden: boolean;
  brandName: string; brandColor: string; profiles: PhoneProfiles;
  navConfig: string; sort: "published" | "arrival"; shortsEnabled: boolean; videoUpdate: Video | null;
  /** A channel opened from outside the phone screens, such as a video's page. */
  channelRequest: { id: string; request: number } | null;
  settings: PhoneSettings; onOpen: OpenVideo;
  onVideoLongPress: (video: Video, onChange: (updated: Video) => void) => void;
  /** Shown where music mode is available. */
  onSwitchToMusic?: () => void;
};

/** The phone layout: a top bar with the account menu, the current screen, and bottom tabs. */
export function PhoneApp({ api, t, language, hidden, brandName, brandColor, profiles, navConfig, sort, shortsEnabled, videoUpdate, channelRequest, settings, onOpen, onVideoLongPress, onSwitchToMusic }: Props) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("home");
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(["home"]));
  const [stack, setStack] = useState<Pushed[]>([]);
  const [account, setAccount] = useState(false);
  const top = stack[stack.length - 1];
  const push = (screen: Pushed) => setStack((current) => [...current, screen]);
  const pop = () => setStack((current) => current.slice(0, -1));
  useMiniPlayerOffset(hidden ? 0 : phoneMetrics.tabBar + insets.bottom);

  useEffect(() => {
    if (channelRequest) push({ kind: "channel", id: channelRequest.id });
  }, [channelRequest]);

  const library = useMemo(() => {
    const { visible, hidden: more } = resolveTvNavigation(navConfig);
    return [...visible, ...more].filter((item) => libraryDestinations.has(item.destination));
  }, [navConfig]);

  useEffect(() => {
    if (hidden) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (account) { setAccount(false); return true; }
      if (stack.length) { pop(); return true; }
      if (tab !== "home") { setTab("home"); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [account, hidden, stack.length, tab]);

  const openLibraryItem = (item: TvNavigationItem) => {
    const title = t(item.labelKey);
    if (item.destination === "/bookmarks") push({ kind: "bookmarks", title });
    else if (item.destination === "/followed-playlists") push({ kind: "playlists", title });
    else push({ kind: "feed", destination: item.destination as TvBrowseDestination, title });
  };
  const openChannel = (id: string) => push({ kind: "channel", id });
  const selectTab = (next: Tab) => {
    setStack([]);
    setTab(next);
    setVisited((current) => current.has(next) ? current : new Set([...current, next]));
  };

  const title = !top ? tab === "search" ? t("searchTitle") : tab === "live" ? t("navLive") : tab === "library" ? t("navLibrary") : brandName
    : top.kind === "settings" ? t("navSettings") : top.kind === "channel" || top.kind === "playlist" ? "" : top.kind === "phoneDownloads" ? t("downloadsOnPhone") : top.title;
  const tabScreen = (key: Tab): ReactNode => {
    if (key === "search") return <PhoneSearchScreen api={api} language={language} t={t} onOpen={onOpen} onOpenChannel={openChannel} onVideoLongPress={onVideoLongPress} />;
    if (key === "live") return <PhoneFeedScreen api={api} destination="/live" sort={sort} language={language} t={t} onOpen={onOpen} videoUpdate={videoUpdate} onVideoLongPress={onVideoLongPress} />;
    if (key === "library") return <View>{phoneDownloads.available ? <PhoneListRow title={t("downloadsOnPhone")}
      icon={<SidebarIcon name="downloads" color={phoneColors.text} size={22} />} onPress={() => push({ kind: "phoneDownloads" })} /> : null}{library.map((item) => <PhoneListRow key={item.key} title={t(item.labelKey)}
      icon={<SidebarIcon name={item.icon} color={phoneColors.text} size={22} />} onPress={() => openLibraryItem(item)} />)}</View>;
    return <PhoneFeedScreen api={api} destination="/" sort={sort} language={language} t={t} onOpen={onOpen} videoUpdate={videoUpdate} onVideoLongPress={onVideoLongPress} />;
  };
  const pushedScreen = (screen: Pushed): ReactNode => {
    switch (screen.kind) {
      case "feed": return <PhoneFeedScreen api={api} destination={screen.destination} sort={sort} language={language} t={t} onOpen={onOpen} videoUpdate={videoUpdate} onVideoLongPress={onVideoLongPress} />;
      case "settings": return <PhoneSettingsScreen api={api} settings={settings} t={t} />;
      case "bookmarks": return <PhoneBookmarksScreen api={api} t={t} videoUpdate={videoUpdate} onOpen={onOpen} />;
      case "playlists": return <PhoneFollowedPlaylistsScreen api={api} t={t} onOpenPlaylist={(playlist) => push({ kind: "playlist", id: playlist.playlist_id, title: playlist.title })} />;
      case "playlist": return <PhonePlaylistScreen api={api} playlistId={screen.id} language={language} t={t} videoUpdate={videoUpdate} onOpen={onOpen} onVideoLongPress={onVideoLongPress} />;
      case "phoneDownloads": return <PhoneDownloadsScreen api={api} t={t} language={language} onOpen={(video) => onOpen(video)} />;
      case "channel": return <PhoneChannelScreen api={api} channelId={screen.id} language={language} t={t} shortsEnabled={shortsEnabled} videoUpdate={videoUpdate} onOpen={onOpen} onVideoLongPress={onVideoLongPress} />;
    }
  };

  const tabs: { key: Tab; icon: "home" | "search" | "live" | "playlists"; label: string }[] = [
    { key: "home", icon: "home", label: t("navToday") },
    { key: "search", icon: "search", label: t("searchTitle") },
    { key: "live", icon: "live", label: t("navLive") },
    { key: "library", icon: "playlists", label: t("navLibrary") },
  ];
  // The app root already keeps clear of the system bars. Visited tabs and the
  // screens under the top of the stack stay mounted, keeping their scroll.
  return <View style={[styles.screen, hidden && styles.hidden]}
    pointerEvents={hidden ? "none" : "auto"} accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}>
    <View style={styles.topBar}>
      {top ? <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel={t("back")} onPress={pop} style={styles.back}>
        <Text style={styles.backGlyph}>‹</Text>
      </Pressable> : tab === "home" ? <LogoMark size={28} color={brandColor} /> : null}
      <Text numberOfLines={1} style={styles.title}>{title}</Text>
      <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel={`${t("account")}: ${profiles.active.name}${profiles.incognito ? `, ${t("incognitoMode")}` : ""}`} onPress={() => setAccount(true)}
        style={[styles.avatarRing, profiles.incognito && styles.incognitoRing]}>
        <PhoneProfileAvatar api={api} profile={profiles.active} size={30} />
      </Pressable>
    </View>
    <View style={styles.body}>
      {tabKeys.filter((key) => visited.has(key)).map((key) => <View key={key} style={[styles.layer, (top || key !== tab) && styles.gone]}>{tabScreen(key)}</View>)}
      {stack.map((screen, index) => <View key={`${index}:${screen.kind}`} style={[styles.layer, index !== stack.length - 1 && styles.gone]}>{pushedScreen(screen)}</View>)}
    </View>
    <View style={styles.tabBar}>
      {tabs.map((item) => {
        const selected = tab === item.key && !top;
        const color = selected ? phoneColors.text : phoneColors.textMuted;
        return <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={item.label}
          onPress={() => selectTab(item.key)} style={styles.tab}>
          <SidebarIcon name={item.icon} color={color} size={24} />
          <Text numberOfLines={1} style={[styles.tabLabel, { color }]}>{item.label}</Text>
        </Pressable>;
      })}
    </View>
    {account ? <PhoneAccountSheet api={api} profiles={profiles} t={t} onClose={() => setAccount(false)}
      modeSwitch={onSwitchToMusic ? { music: false, onPress: onSwitchToMusic } : undefined}
      onHistory={() => { setAccount(false); push({ kind: "feed", destination: "/history", title: t("navHistory") }); }}
      onSettings={() => { setAccount(false); push({ kind: "settings" }); }} /> : null}
  </View>;
}


const styles = StyleSheet.create({
  screen: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: phoneColors.background },
  hidden: { opacity: 0 },
  topBar: { height: phoneMetrics.topBar, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: phoneMetrics.gutter },
  back: { width: 28, alignItems: "flex-start" },
  backGlyph: { color: phoneColors.text, fontSize: 34, lineHeight: 36, marginTop: -4 },
  title: { flex: 1, ...phoneType.heading, color: phoneColors.text },
  // Incognito is shown as a ring around the avatar.
  avatarRing: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  incognitoRing: { borderColor: phoneColors.textMuted, borderStyle: "dashed" },
  body: { flex: 1 },
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  gone: { display: "none" },
  tabBar: { height: phoneMetrics.tabBar, flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: phoneColors.divider, backgroundColor: phoneColors.background },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingTop: 6 },
  tabLabel: { fontSize: 11.5, fontWeight: "600" },
});
