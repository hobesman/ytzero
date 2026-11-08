import { useEffect, useMemo, useState } from "react";
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
import { PhoneAccountSheet } from "./PhoneAccountSheet";
import { PhoneFeedScreen } from "./PhoneFeedScreen";
import { PhoneListRow } from "./PhoneList";
import { PhoneSearchScreen } from "./PhoneSearchScreen";
import { PhoneSettingsScreen, type PhoneSettings } from "./PhoneSettingsScreen";
import { phoneColors, phoneMetrics, phoneType } from "./phoneTheme";

type Tab = "home" | "search" | "live" | "library";
/** A screen pushed above a tab: a Library entry, History or Settings. */
type Pushed = { kind: "feed"; destination: TvBrowseDestination; title: string } | { kind: "settings" } | { kind: "notReady"; title: string };

const libraryDestinations = new Set<string>(["/watchlist", "/followed-playlists", "/downloads", "/liked", "/bookmarks", "/archive", "/recommendations", "/shorts"]);
const feedReady = new Set<string>(["/watchlist", "/downloads", "/liked", "/archive", "/recommendations", "/shorts"]);

type Props = {
  api: YtZeroApi; t: Translate; language: Language; hidden: boolean;
  brandName: string; brandColor: string; profileName: string; profileColor: string;
  navConfig: string; sort: "published" | "arrival"; videoUpdate: Video | null;
  settings: PhoneSettings; onOpen: OpenVideo;
};

/** The phone layout: a top bar with the account menu, the current screen, and bottom tabs. */
export function PhoneApp({ api, t, language, hidden, brandName, brandColor, profileName, profileColor, navConfig, sort, videoUpdate, settings, onOpen }: Props) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("home");
  const [pushed, setPushed] = useState<Pushed | null>(null);
  const [account, setAccount] = useState(false);
  useMiniPlayerOffset(hidden ? 0 : phoneMetrics.tabBar + insets.bottom);

  const library = useMemo(() => {
    const { visible, hidden: more } = resolveTvNavigation(navConfig);
    return [...visible, ...more].filter((item) => libraryDestinations.has(item.destination));
  }, [navConfig]);

  useEffect(() => {
    if (hidden) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (account) { setAccount(false); return true; }
      if (pushed) { setPushed(null); return true; }
      if (tab !== "home") { setTab("home"); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [account, hidden, pushed, tab]);

  const openLibraryItem = (item: TvNavigationItem) => {
    const title = t(item.labelKey);
    setPushed(feedReady.has(item.destination) ? { kind: "feed", destination: item.destination as TvBrowseDestination, title } : { kind: "notReady", title });
  };
  const selectTab = (next: Tab) => { setPushed(null); setTab(next); };

  const title = pushed ? pushed.kind === "settings" ? t("navSettings") : pushed.title
    : tab === "search" ? t("searchTitle") : tab === "live" ? t("navLive") : tab === "library" ? t("navLibrary") : brandName;
  let body;
  if (pushed?.kind === "feed") body = <PhoneFeedScreen key={pushed.destination} api={api} destination={pushed.destination} sort={sort} language={language} t={t} onOpen={onOpen} videoUpdate={videoUpdate} />;
  else if (pushed?.kind === "settings") body = <PhoneSettingsScreen settings={settings} t={t} />;
  else if (pushed?.kind === "notReady") body = <View style={styles.notReady}><Text style={styles.notReadyText}>{t("phoneScreenNotReady")}</Text></View>;
  else if (tab === "search") body = <PhoneSearchScreen api={api} language={language} t={t} onOpen={onOpen} />;
  else if (tab === "live") body = <PhoneFeedScreen key="live" api={api} destination="/live" sort={sort} language={language} t={t} onOpen={onOpen} videoUpdate={videoUpdate} />;
  else if (tab === "library") body = <View>{library.map((item) => <PhoneListRow key={item.key} title={t(item.labelKey)}
    icon={<SidebarIcon name={item.icon} color={phoneColors.text} size={22} />} onPress={() => openLibraryItem(item)} />)}</View>;
  else body = <PhoneFeedScreen key="home" api={api} destination="/" sort={sort} language={language} t={t} onOpen={onOpen} videoUpdate={videoUpdate} />;

  const tabs: { key: Tab; icon: "home" | "search" | "live" | "playlists"; label: string }[] = [
    { key: "home", icon: "home", label: t("navToday") },
    { key: "search", icon: "search", label: t("searchTitle") },
    { key: "live", icon: "live", label: t("navLive") },
    { key: "library", icon: "playlists", label: t("navLibrary") },
  ];
  // The app root already keeps clear of the system bars.
  return <View style={[styles.screen, hidden && styles.hidden]}
    pointerEvents={hidden ? "none" : "auto"} accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}>
    <View style={styles.topBar}>
      {pushed ? <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => setPushed(null)} style={styles.back}>
        <Text style={styles.backGlyph}>‹</Text>
      </Pressable> : tab === "home" ? <LogoMark size={28} color={brandColor} /> : null}
      <Text numberOfLines={1} style={styles.title}>{title}</Text>
      <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel={`${t("account")}: ${profileName}`} onPress={() => setAccount(true)}
        style={[styles.avatar, { backgroundColor: profileColor }]}>
        <Text style={styles.initial}>{profileName.slice(0, 1).toUpperCase()}</Text>
      </Pressable>
    </View>
    <View style={styles.body}>{body}</View>
    <View style={styles.tabBar}>
      {tabs.map((item) => {
        const selected = tab === item.key && !pushed;
        const color = selected ? phoneColors.text : phoneColors.textMuted;
        return <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={item.label}
          onPress={() => selectTab(item.key)} style={styles.tab}>
          <SidebarIcon name={item.icon} color={color} size={24} />
          <Text numberOfLines={1} style={[styles.tabLabel, { color }]}>{item.label}</Text>
        </Pressable>;
      })}
    </View>
    {account ? <PhoneAccountSheet name={profileName} color={profileColor} t={t} onClose={() => setAccount(false)}
      onHistory={() => { setAccount(false); setPushed({ kind: "feed", destination: "/history", title: t("navHistory") }); }}
      onSettings={() => { setAccount(false); setPushed({ kind: "settings" }); }} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: phoneColors.background },
  hidden: { opacity: 0 },
  topBar: { height: phoneMetrics.topBar, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: phoneMetrics.gutter },
  back: { width: 28, alignItems: "flex-start" },
  backGlyph: { color: phoneColors.text, fontSize: 34, lineHeight: 36, marginTop: -4 },
  title: { flex: 1, ...phoneType.heading, color: phoneColors.text },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  initial: { color: "#fff", fontSize: 14, fontWeight: "700" },
  body: { flex: 1 },
  notReady: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  notReadyText: { ...phoneType.body, color: phoneColors.textMuted, textAlign: "center" },
  tabBar: { height: phoneMetrics.tabBar, flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: phoneColors.divider, backgroundColor: phoneColors.background },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingTop: 6 },
  tabLabel: { fontSize: 11.5, fontWeight: "600" },
});
