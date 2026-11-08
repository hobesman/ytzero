import { isFocusInteraction } from "./src/focusEntry";
import { lastActivatedVideoTarget, requestTvFocus, TvContentFocusRequests, useTvShellFocus } from "./src/focus";
import { restoreFocus } from "./src/focusRestoration";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Animated, BackHandler, Platform, StyleSheet, TVEventControl, TVFocusGuideView, useTVEventHandler, useWindowDimensions, View, type FocusDestination } from "react-native";
import { YtZeroApi } from "./src/api";
import { deviceLanguage, normalizeLanguage, translator, type Translate } from "./src/i18n";
import { InstanceScreen } from "./src/screens/InstanceScreen";
import { PairScreen } from "./src/screens/PairScreen";
import { SearchScreen } from "./src/screens/SearchScreen";
import { FeedScreen } from "./src/screens/FeedScreen";
import { BookmarksScreen } from "./src/screens/BookmarksScreen";
import { FollowedPlaylistsScreen } from "./src/screens/FollowedPlaylistsScreen";
import { ChannelScreen } from "./src/screens/ChannelScreen";
import { WatchScreen } from "./src/screens/WatchScreen";
import { deviceStore, legacyDeviceStore } from "./src/deviceStore";
import { systemProfilesNative } from "./src/systemProfilesNative";
import { loadSystemProfilesEnabled, saveSystemProfilesEnabled, parseProfilePreference, profilePreference, resolveSystemProfile, type ProfileState, type ProfilePreference } from "./src/systemProfiles";
import { TvSetupLayout } from "./src/components/TvSetupLayout";
import { loadOpenDetails, loadPhoneLayout, saveOpenDetails, savePhoneLayout, shouldPlayVideo } from "./src/devicePreferences";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { TvSidebar } from "./src/components/TvSidebar";
import { TvProfileMenu } from "./src/components/TvProfileMenu";
import { TvLoadingMark } from "./src/components/TvLoadingMark";
import { TvLaunchAnimation } from "./src/components/TvLaunchAnimation";
import { PhoneScale, usePhoneScale } from "./src/components/PhoneScale";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MiniPlayerHost } from "./src/components/MiniPlayerHost";
import { TvScreenTransition } from "./src/components/TvScreenTransition";
import { TvMotionProvider } from "./src/motion";
import { setSessionCookie } from "./src/sessionCookie";
import { setPhoneImmersive, setPhoneOrientation } from "./src/phoneOrientation";
import { PhoneApp } from "./src/phone/PhoneApp";
import { PhoneVideoActionSheet } from "./src/phone/PhoneVideoActionSheet";
import { TvBackdrop } from "./src/components/TvBackdrop";
import { TvVideoActionMenu, type VideoActionOptions } from "./src/components/TvVideoActionMenu";
import { isTvBrowseDestination, type TvBrowseDestination, type TvDestination } from "./src/navigation";
import { clearAccessToken, loadConnection, saveConnection } from "./src/storage";
import type { AuthStatus, Language, PairingAuthorization, Video } from "./src/types";
import { colors, sidebarRailWidth, topBarMetrics } from "./src/theme";
import { tvVideoCardActionConfig, type VideoCardActionConfig } from "./src/videoCardActions";
import { SessionQueueProvider, useSessionQueueActions, useSessionQueueItems } from "./src/SessionQueue";
import { TvQueueSheet } from "./src/components/TvQueueSheet";
import { TvSurface } from "./src/components/TvSurface";
import { TvButton } from "./src/components/TvButton";
import { TvFocusScope } from "./src/components/TvFocusScope";
import { TvGlassVisibility } from "./src/components/TvGlassSurface";
import type { OpenVideo, PlaybackQueueContext } from "./src/playbackQueue";

type Screen = "profile-selection" | "boot" | "instance" | "pair" | "channel" | "playlist" | "detail" | TvDestination;
type DetailReturnScreen = "channel" | "playlist" | TvBrowseDestination;

type VideoActionRequest = { video: Video; onChange: (updated: Video) => void; options?: VideoActionOptions };
type BackdropController = ReturnType<typeof createBackdropController>;

function createBackdropController() {
  let current = "";
  const listeners = new Set<(thumbnail: string) => void>();
  return {
    current: () => current,
    set: (thumbnail: string) => {
      if (thumbnail === current) return;
      current = thumbnail;
      listeners.forEach((listener) => listener(thumbnail));
    },
    subscribe: (listener: (thumbnail: string) => void) => {
      listeners.add(listener);
      listener(current);
      return () => { listeners.delete(listener); };
    },
  };
}

function TvHomeBackdrop({ api, controller, height, opacity }: {
  api: YtZeroApi; controller: BackdropController; height: number; opacity: Animated.Value | Animated.AnimatedInterpolation<number>;
}) {
  const [thumbnail, setThumbnail] = useState(controller.current);
  useEffect(() => controller.subscribe(setThumbnail), [controller]);
  if (!thumbnail) return null;
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
    <TvBackdrop source={api.backdropSource(thumbnail)} fallbackSource={api.thumbnailSource(thumbnail)} style={{ height }} />
  </Animated.View>;
}

function TvQueueTrigger({ trigger, t, nextFocusDown, nextFocusRight, onOpen }: {
  trigger: RefObject<View | null>;
  t: Translate;
  nextFocusDown?: FocusDestination;
  nextFocusRight?: FocusDestination;
  onOpen: () => void;
}) {
  const items = useSessionQueueItems();
  return <TvButton ref={trigger} deferPress variant="ghost" label={items.length ? String(items.length) : ""} icon="queue"
    accessibilityLabel={t("playQueue")} nextFocusDown={nextFocusDown} nextFocusRight={nextFocusRight}
    style={styles.queueTrigger} onPress={onOpen} />;
}

/** Android phones (not TVs) can use the phone design instead of the scaled TV layout. */
const phoneDesignAvailable = Platform.OS === "android" && !Platform.isTV;

export default function App() {
  return <SafeAreaProvider><MiniPlayerHost><TvMotionProvider><SessionQueueProvider><TvApp /></SessionQueueProvider></TvMotionProvider></MiniPlayerHost></SafeAreaProvider>;
}

function TvApp() {
  const [launchVisible, setLaunchVisible] = useState(true);
  const [launchRevealing, setLaunchRevealing] = useState(false);
  const { clear: clearQueue } = useSessionQueueActions();
  const [queueVisible, setQueueVisible] = useState(false);
  const queueTrigger = useRef<View>(null);
  const queueReturnFocus = useRef<View | null>(null);
  const returnFocus = useRef<{ current: View | null } | null>(null);
  const cancelFocusReturn = useRef<(() => void) | null>(null);
  const previousScreen = useRef<Screen>("boot");
  const [screen, setScreen] = useState<Screen>("boot");
  // Setup screens have phone layouts of their own; everything else is the TV layout, scaled on phones.
  // Android phones use the phone design by default; Settings can switch to the scaled TV layout.
  const [phoneDesign, setPhoneDesign] = useState(phoneDesignAvailable);
  const phoneMode = phoneDesign && phoneDesignAvailable;
  const [phonePlaying, setPhonePlaying] = useState(false);
  const [phoneChannelRequest, setPhoneChannelRequest] = useState<{ id: string; request: number } | null>(null);
  // Phones: a fullscreen video, and holding portrait after the viewer leaves fullscreen.
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  const [portraitHeld, setPortraitHeld] = useState(false);
  const phoneLayout = usePhoneScale(!phoneMode && screen !== "instance" && screen !== "pair");
  const { width, height } = phoneLayout.size;
  const backdropController = useMemo(createBackdropController, []);
  const backdropScroll = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useMemo(() => backdropScroll.interpolate({
    inputRange: [0, height * 0.7], outputRange: [1, 0], extrapolate: "clamp",
  }), [backdropScroll, height]);
  const [instanceUrl, setInstanceUrl] = useState("");
  const [accessToken, setAccessToken] = useState<string | undefined>();
  const [pairing, setPairing] = useState<PairingAuthorization | null>(null);
  const [pairingInstanceUrl, setPairingInstanceUrl] = useState("");
  const [pairingFromSettings, setPairingFromSettings] = useState(false);
  const [language, setLanguage] = useState<Language>(deviceLanguage);
  const [sidebarNav, setSidebarNav] = useState("");
  const [brandName, setBrandName] = useState("YT Zero");
  const [brandColor, setBrandColor] = useState<string>(colors.accent);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [detailFocusTarget, setDetailFocusTarget] = useState<View | null>(null);
  const [profileMenuVisible, setProfileMenuVisible] = useState(false);
  const [topBarTarget, setTopBarTarget] = useState<View | null>(null);
  const [feedSort, setFeedSort] = useState<"published" | "arrival">("published");
  const [showTopChannels, setShowTopChannels] = useState(true);
  const [shortsEnabled, setShortsEnabled] = useState(true);
  const [videoActionConfig, setVideoActionConfig] = useState<VideoCardActionConfig>(() => tvVideoCardActionConfig(null));
  const [videoActionRequest, setVideoActionRequest] = useState<VideoActionRequest | null>(null);
  const [profileState, setProfileState] = useState<ProfileState | null>(null);
  const [incognito, setIncognito] = useState(false);
  const [profileFocusTarget, setProfileFocusTarget] = useState<View | null>(null);
  const [contentFocusTarget, setContentFocusTarget] = useState<FocusDestination | null>(null);
  const contentFocusFallback = useRef<View | null>(null);
  contentFocusFallback.current = contentFocusTarget as View | null;
  const [returnDestination, setReturnDestination] = useState<TvBrowseDestination>("/");
  const [detailReturnScreen, setDetailReturnScreen] = useState<DetailReturnScreen>("/");
  const [playerDocked, setPlayerDocked] = useState(false);
  const playerDockedRef = useRef(playerDocked);
  playerDockedRef.current = playerDocked;
  const [contentFocusRequest, setContentFocusRequest] = useState(0);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Video | null>(null);
  const [videoOpenRequest, setVideoOpenRequest] = useState(0);
  const [selectedQueue, setSelectedQueue] = useState<PlaybackQueueContext | null>(null);
  const [openDetails, setOpenDetails] = useState(false);
  const [connectionId, setConnectionId] = useState("");
  const [systemProfilesEnabled, setSystemProfilesEnabled] = useState(false);
  const [canRememberSystemProfile, setCanRememberSystemProfile] = useState(false);
  const [linkedProfile, setLinkedProfile] = useState<ProfilePreference | null>(null);
  const [preferredProfileId, setPreferredProfileId] = useState<number>();
  const [bootError, setBootError] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [startPosition, setStartPosition] = useState<number | undefined>();
  const [videoUpdate, setVideoUpdate] = useState<Video | null>(null);
  const t = useMemo(() => translator(language), [language]);
  const api = useMemo(() => instanceUrl ? new YtZeroApi(instanceUrl, accessToken) : null, [accessToken, instanceUrl]);
  const pairingApi = useMemo(() => pairingInstanceUrl ? new YtZeroApi(pairingInstanceUrl) : null, [pairingInstanceUrl]);
  // Android thumbnails authenticate with the session cookie; see sessionCookie.android.ts.
  const cookieInstance = useRef<string | null>(null);
  useEffect(() => {
    const previous = cookieInstance.current;
    cookieInstance.current = instanceUrl ?? null;
    void (async () => {
      if (previous && previous !== instanceUrl) await setSessionCookie(previous, null);
      if (instanceUrl) await setSessionCookie(instanceUrl, accessToken ?? null);
    })().catch(() => {});
  }, [accessToken, instanceUrl]);
  const browsingScreen = screen === "detail" ? detailReturnScreen : screen;
  const shellDestination: TvDestination | null = browsingScreen === "playlist" ? "/followed-playlists" : browsingScreen === "channel" ? returnDestination : browsingScreen === "/settings" || isTvBrowseDestination(browsingScreen) ? browsingScreen : null;
  const hasShell = Boolean(api) && shellDestination !== null;
  const inShell = hasShell && screen !== "detail";
  const focusContext = useMemo(() => ({}), [screen, contentFocusRequest, api, profileState?.active.id]);
  const shellFocus = useTvShellFocus(focusContext, inShell && launchRevealing);
  const screenRef = useRef(screen);
  const queueVisibleRef = useRef(queueVisible);
  const openDetailsRef = useRef(openDetails);
  screenRef.current = screen;
  queueVisibleRef.current = queueVisible;
  openDetailsRef.current = openDetails;

  useEffect(() => {
    clearQueue();
    setQueueVisible(false);
    setSelectedQueue(null);
  }, [instanceUrl, accessToken, profileState?.active.id, incognito, clearQueue]);

  const openVideo = useCallback<OpenVideo>((video, context, play, position) => {
    if (screenRef.current !== "detail") returnFocus.current = queueVisibleRef.current ? queueTrigger : lastActivatedVideoTarget() ?? contentFocusFallback;
    setSelected(video);
    // Selecting the current film in the queue is a new playback request too.
    setVideoOpenRequest((request) => request + 1);
    setSelectedQueue(context ?? null);
    setAutoplay(shouldPlayVideo(openDetailsRef.current, play));
    setStartPosition(position);
    setPlayerDocked(false);
    setScreen("detail");
  }, []);
  const openQueueFromTopBar = useCallback(() => {
    queueReturnFocus.current = queueTrigger.current;
    setQueueVisible(true);
  }, []);

  const openChannelVideo = useCallback<OpenVideo>((video, context, play, position) => {
    setDetailReturnScreen("channel");
    openVideo(video, context, play, position);
  }, [openVideo]);
  const openBookmarkVideo = useCallback<OpenVideo>((video, context, play, position) => {
    setDetailReturnScreen("/bookmarks");
    setReturnDestination("/bookmarks");
    openVideo(video, context, play, position);
  }, [openVideo]);
  const openPlaylistVideo = useCallback<OpenVideo>((video, context, play, position) => {
    setDetailReturnScreen("playlist");
    openVideo(video, context, play, position);
  }, [openVideo]);
  const openSearchVideo = useCallback<OpenVideo>((video, context, play, position) => {
    setDetailReturnScreen("/search");
    setReturnDestination("/search");
    openVideo(video, context, play, position);
  }, [openVideo]);
  const openBrowseVideo = useCallback<OpenVideo>((video, context, play, position) => {
    if (!isTvBrowseDestination(browsingScreen)) return;
    setDetailReturnScreen(browsingScreen);
    setReturnDestination(browsingScreen);
    openVideo(video, context, play, position);
  }, [browsingScreen, openVideo]);
  const selectPlaylist = useCallback((id: string) => {
    setSelectedPlaylistId(id);
    setContentFocusTarget(null);
    setContentFocusRequest((request) => request + 1);
    setReturnDestination("/followed-playlists");
    setScreen("playlist");
  }, []);
  const closePlaylist = useCallback(() => {
    setSelectedPlaylistId(null);
    setContentFocusTarget(null);
    setContentFocusRequest((request) => request + 1);
    setScreen("/followed-playlists");
  }, []);

  useEffect(() => {
    const returning = previousScreen.current === "detail" && screen === detailReturnScreen;
    previousScreen.current = screen;
    if (!returning) return;
    const target = returnFocus.current;
    let active = true;
    const cancel = restoreFocus(() => target?.current ?? null, async (view) => {
      const focused = await requestTvFocus(view, () => active);
      if (active && focused) shellFocus.onContentFocus();
      return focused;
    }, () => contentFocusFallback.current);
    const stop = () => { active = false; cancel(); };
    cancelFocusReturn.current = stop;
    return () => { stop(); cancelFocusReturn.current = null; };
  }, [detailReturnScreen, screen, shellFocus.onContentFocus]);

  useTVEventHandler((event) => {
    // Menu starts the return itself; its delayed native event must not cancel it.
    if (event.eventType !== "menu" && isFocusInteraction(event)) cancelFocusReturn.current?.();
  });

  useEffect(() => {
    if (profileState?.active.is_child) setIncognito(false);
  }, [profileState?.active.is_child]);

  useEffect(() => {
    if (__DEV__) console.info("[YT Zero TV] navigation", { screen, connected: Boolean(instanceUrl), authenticated: Boolean(accessToken) });
  }, [accessToken, instanceUrl, screen]);

  useEffect(() => {
    const canCancelConnectionFlow = pairingFromSettings && (screen === "instance" || screen === "pair");
    if (screen !== "channel" && screen !== "playlist" && screen !== "detail" && screen !== "/settings" && !canCancelConnectionFlow) {
      TVEventControl.disableTVMenuKey();
      return;
    }
    TVEventControl.enableTVMenuKey();
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canCancelConnectionFlow) {
        setPairing(null);
        setPairingInstanceUrl("");
        setPairingFromSettings(false);
        setContentFocusTarget(null);
        setContentFocusRequest((request) => request + 1);
        setScreen("/settings");
        return true;
      }
      if (screen === "detail") {
        // Phones: Back leaves fullscreen, then keeps a playing video going in the mini player.
        if (phoneMode && videoFullscreen) { setPortraitHeld(true); setVideoFullscreen(false); return true; }
        if (phoneMode && phonePlaying) {
          setPlayerDocked(true);
          setScreen(detailReturnScreen);
          return true;
        }
        setSelected(null);
        setScreen(detailReturnScreen);
        return true;
      }
      if (screen === "playlist") {
        setSelectedPlaylistId(null);
        setContentFocusTarget(null);
        setContentFocusRequest((request) => request + 1);
        setScreen("/followed-playlists");
        return true;
      }
      if (screen === "channel") {
        setSelectedPlaylistId(null);
        setSelectedChannelId(null);
        setContentFocusTarget(null);
        setContentFocusRequest((request) => request + 1);
      }
      setScreen(returnDestination);
      return true;
    });
    return () => {
      subscription.remove();
      TVEventControl.disableTVMenuKey();
    };
  }, [detailReturnScreen, pairingFromSettings, phoneMode, phonePlaying, returnDestination, screen, videoFullscreen]);

  const navigate = useCallback((destination: TvDestination) => {
    setSelectedPlaylistId(null);
    setSelectedChannelId(null);
    setContentFocusTarget(null);
    if (isTvBrowseDestination(destination)) setReturnDestination(destination);
    setContentFocusRequest((request) => request + 1);
    setScreen(destination);
  }, []);

  const readProfileSettings = useCallback(async (client: YtZeroApi) => {
    try {
      const result = await client.settings();
      setLanguage(normalizeLanguage(result.settings.language));
      setBrandName(result.settings.app_name?.trim() || "YT Zero");
      setBrandColor(/^#[0-9a-f]{6}$/i.test(result.settings.app_icon_color ?? "") ? result.settings.app_icon_color! : colors.accent);
      setSidebarNav(typeof result.settings.sidebar_nav === "string" ? result.settings.sidebar_nav : "");
      setFeedSort(result.settings.feed_sort === "arrival" ? "arrival" : "published");
      setShowTopChannels(result.settings.show_top_channels !== "0");
      setShortsEnabled(result.settings.show_shorts !== "disabled");
      setVideoActionConfig(tvVideoCardActionConfig(result.settings.video_card_action_buttons));
    } catch {
      // Device locale remains the safe fallback when this profile cannot read settings.
    }
  }, []);

  const readProfileState = useCallback(async (client: YtZeroApi, knownAuth?: AuthStatus): Promise<ProfileState> => {
    const [auth, result, childLockResult] = await Promise.all([
      knownAuth ? Promise.resolve(knownAuth) : client.authStatus(), client.profiles(), client.childLock(),
    ]);
    const active = result.profiles.find((profile) => profile.id === result.active_id);
    if (!active) throw new Error("active profile unavailable");
    const canSwitch = auth.can_switch && !auth.hide_other_profiles;
    const state = { active, profiles: canSwitch ? result.profiles : [active], canSwitch, childLockEnabled: childLockResult.child_lock.enabled };
    setProfileState(state);
    return state;
  }, []);

  const initializeProfileSession = useCallback(async (client: YtZeroApi, auth: AuthStatus, id: string): Promise<Screen> => {
    const [enabled, canRemember, saved] = await Promise.all([
      loadSystemProfilesEnabled(deviceStore), systemProfilesNative.canRemember(), systemProfilesNative.readPreference(),
    ]);
    const preference = parseProfilePreference(saved, id);
    setConnectionId(id);
    setSystemProfilesEnabled(enabled);
    setCanRememberSystemProfile(canRemember);
    setLinkedProfile(preference);
    const state = await readProfileState(client, auth);
    const resolution = resolveSystemProfile(enabled, canRemember, preference, state);
    if (resolution.kind === "choose") {
      setPreferredProfileId(resolution.preferredProfileId);
      return "profile-selection";
    }
    if (resolution.kind === "switch") {
      try {
        await client.switchProfile(resolution.profile.id);
        const switched = await readProfileState(client);
        if (switched.active.id !== resolution.profile.id) throw new Error("profile switch not applied");
      } catch {
        // Never reveal the previous user's feed if authorization changed or the
        // switch failed. The existing picker handles PINs and retry explicitly.
        setPreferredProfileId(resolution.profile.id);
        return "profile-selection";
      }
    }
    await readProfileSettings(client);
    return "/";
  }, [readProfileSettings, readProfileState]);

  const createPairing = useCallback(async (url: string, replaceCurrentConnection: boolean) => {
    const anonymous = new YtZeroApi(url);
    await anonymous.health();
    const authorization = await anonymous.beginPairing();
    if (replaceCurrentConnection) {
      setConnectionId(await saveConnection(url, null));
      setInstanceUrl(url);
      setAccessToken(undefined);
      setProfileState(null);
    }
    setPairingInstanceUrl(url);
    setPairing(authorization);
    setScreen("pair");
  }, []);

  const beginPairing = useCallback(async (url: string) => {
    await createPairing(url, true);
  }, [createPairing]);

  const beginSettingsPairing = useCallback(async (url: string) => {
    await createPairing(url, false);
  }, [createPairing]);

  useEffect(() => {
    let active = true;
    setBootError(false);
    setScreen("boot");
    void (async () => {
      try {
        const [stored, detailsPreference, phonePreference] = await Promise.all([loadConnection(), loadOpenDetails(deviceStore, legacyDeviceStore).catch(() => false), loadPhoneLayout(deviceStore, phoneDesignAvailable).catch(() => phoneDesignAvailable)]);
        if (!active) return;
        setOpenDetails(detailsPreference);
        setPhoneDesign(phonePreference);
        if (!stored.instanceUrl) return setScreen("instance");
        setInstanceUrl(stored.instanceUrl);
        if (!stored.accessToken) {
          await beginPairing(stored.instanceUrl);
          return;
        }
        const restored = new YtZeroApi(stored.instanceUrl, stored.accessToken);
        const auth = await restored.authStatus();
        if (!active) return;
        if (!auth.authenticated) {
          await clearAccessToken();
          await beginPairing(stored.instanceUrl);
          return;
        }
        if (stored.legacyShared && auth.scope !== "account") {
          // An old device-wide profile session has no provable system-user
          // owner. Re-pair instead of giving it to whichever user opens first.
          await beginPairing(stored.instanceUrl);
          return;
        }
        // Migrate only after verifying token scope. Older servers without scope
        // retain a personal pairing instead of sharing an unknown credential.
        const id = stored.connectionId || await saveConnection(stored.instanceUrl, stored.accessToken, auth.scope === "account" ? "account" : "profile");
        setAccessToken(stored.accessToken);
        const destination = await initializeProfileSession(restored, auth, id);
        if (active) setScreen(destination);
      } catch {
        // Network/storage failures must not discard a valid pairing or expose
        // content under a stale profile. Retrying repeats the whole selection.
        if (active) setBootError(true);
      }
    })();
    return () => { active = false; };
  }, [beginPairing, initializeProfileSession, bootAttempt]);

  const authorize = useCallback(async (token: string) => {
    const authorizedInstanceUrl = pairingInstanceUrl || instanceUrl;
    const authenticated = new YtZeroApi(authorizedInstanceUrl, token);
    const auth = await authenticated.authStatus();
    if (!auth.authenticated) throw new Error("pairing authorization expired");
    const id = await saveConnection(authorizedInstanceUrl, token, auth.scope === "account" ? "account" : "profile");
    const destination = await initializeProfileSession(authenticated, auth, id);
    setInstanceUrl(authorizedInstanceUrl);
    setAccessToken(token);
    setIncognito(false);
    setPairing(null);
    setPairingInstanceUrl("");
    setPairingFromSettings(false);
    setSelected(null);
    setSelectedPlaylistId(null);
    setSelectedChannelId(null);
    setVideoUpdate(null);
    setReturnDestination("/");
    setScreen(destination);
  }, [instanceUrl, pairingInstanceUrl, initializeProfileSession]);

  const retryPairing = useCallback(async () => {
    await createPairing(pairingInstanceUrl || instanceUrl, !pairingFromSettings);
  }, [createPairing, instanceUrl, pairingFromSettings, pairingInstanceUrl]);

  const signOut = useCallback(async () => {
    try { await api?.logout(); } catch { /* Local cleanup still signs this television out. */ }
    await clearAccessToken();
    await systemProfilesNative.writePreference(null);
    setLinkedProfile(null);
    setAccessToken(undefined);
    setProfileState(null);
    setIncognito(false);
    setSelected(null);
    setSelectedPlaylistId(null);
    setSelectedChannelId(null);
    setPairingFromSettings(false);
    await beginPairing(instanceUrl);
  }, [api, beginPairing, instanceUrl]);

  const startInstanceChange = useCallback(async () => {
    setPairingFromSettings(true);
    setPairingInstanceUrl(instanceUrl);
    setPairing(null);
    setSelected(null);
    setSelectedPlaylistId(null);
    setSelectedChannelId(null);
    setContentFocusTarget(null);
    setScreen("instance");
  }, [instanceUrl]);

  const editPairingInstance = useCallback(() => {
    setPairing(null);
    setScreen("instance");
  }, []);

  const cancelInstanceChange = useCallback(() => {
    setPairing(null);
    setPairingInstanceUrl("");
    setPairingFromSettings(false);
    setContentFocusTarget(null);
    setContentFocusRequest((request) => request + 1);
    setScreen("/settings");
  }, []);

  const switchProfile = useCallback(async (profileId: number, pin?: string, childLockPin?: string) => {
    if (!api) throw new Error("not connected");
    const current = await readProfileState(api);
    const target = current.profiles.find((profile) => profile.id === profileId);
    if (!target || target.pin_locked || (target.id !== current.active.id && (!current.canSwitch || !target.can_switch))) throw new Error("profile unavailable");
    // The server may have completed an earlier request whose reply was lost.
    // Refresh its actual profile before deciding which PINs are required.
    if (target.has_pin && !/^\d{6}$/.test(pin ?? "")) throw new Error("profile PIN required");
    if (target.id !== current.active.id && current.active.is_child && current.childLockEnabled && !/^\d{6}$/.test(childLockPin ?? "")) throw new Error("child lock PIN required");
    if (profileId !== current.active.id || target.has_pin) await api.switchProfile(profileId, pin, childLockPin);
    setIncognito(false);
    setSelected(null);
    setVideoUpdate(null);
    const updated = await readProfileState(api);
    if (updated.active.id !== profileId) throw new Error("profile switch not applied");
    if (screen === "profile-selection" && canRememberSystemProfile && updated.active.uuid) {
      const saved = profilePreference(connectionId, updated.active);
      await systemProfilesNative.writePreference(saved);
      setLinkedProfile(parseProfilePreference(saved, connectionId));
    }
    await readProfileSettings(api);
    if (screen === "profile-selection") setScreen("/");
    setContentFocusRequest((request) => request + 1);
  }, [api, canRememberSystemProfile, connectionId, screen, readProfileSettings, readProfileState]);

  const linkCurrentProfile = useCallback(async () => {
    if (!profileState || !canRememberSystemProfile) throw new Error("system profile unavailable");
    const saved = profilePreference(connectionId, profileState.active);
    await systemProfilesNative.writePreference(saved);
    setLinkedProfile(parseProfilePreference(saved, connectionId));
  }, [canRememberSystemProfile, connectionId, profileState]);

  const changeSystemProfilesEnabled = useCallback(async (enabled: boolean) => {
    if (enabled) await linkCurrentProfile();
    await saveSystemProfilesEnabled(deviceStore, enabled);
    setSystemProfilesEnabled(enabled);
  }, [linkCurrentProfile]);

  const openChannel = useCallback((channelId: string) => {
    setVideoActionRequest(null);
    // Phones: the channel opens on the phone screens' stack; a playing video moves to the mini player.
    if (phoneMode) {
      if (screenRef.current === "detail") {
        if (phonePlaying) setPlayerDocked(true);
        else setSelected(null);
      }
      setPhoneChannelRequest((current) => ({ id: channelId, request: (current?.request ?? 0) + 1 }));
      setScreen("/");
      return;
    }
    if (!playerDockedRef.current) setSelected(null);
    setSelectedChannelId(channelId);
    setContentFocusTarget(null);
    setContentFocusRequest((request) => request + 1);
    setScreen("channel");
  }, [phoneMode, phonePlaying]);
  const openSearch = useCallback(() => navigate("/search"), [navigate]);
  const openChannelResult = useCallback((channel: import("./src/types").Channel) => openChannel(channel.channel_id), [openChannel]);

  const openVideoActions = useCallback((video: Video, onChange: (updated: Video) => void, options?: VideoActionOptions) => {
    setVideoActionRequest({ video, onChange, options });
  }, []);
  const changeActionVideo = (updated: Video) => {
    videoActionRequest?.onChange(updated);
    setVideoActionRequest((current) => current ? { ...current, video: updated } : null);
    setSelected((current) => current?.video_id === updated.video_id ? updated : current);
  };

  const closeChannel = useCallback(() => {
    setSelectedPlaylistId(null);
    setSelectedChannelId(null);
    setContentFocusTarget(null);
    setContentFocusRequest((request) => request + 1);
    setScreen(returnDestination);
  }, [returnDestination]);

  const changePhoneDesign = useCallback(async (value: boolean) => {
    await savePhoneLayout(deviceStore, value);
    setPhoneDesign(value);
  }, []);
  // The phone design browses in portrait. On a video's page the phone may rotate, and turning it
  // sideways while the video plays goes fullscreen; leaving fullscreen holds portrait for that video.
  // The scaled TV layout stays landscape.
  const videoOpen = screen === "detail" && !playerDocked;
  const windowSize = useWindowDimensions();
  useEffect(() => {
    if (!phoneDesignAvailable) return;
    setPhoneOrientation(!phoneMode ? "landscape" : !videoOpen ? "portrait" : videoFullscreen ? "landscape" : portraitHeld ? "portrait" : "sensor");
  }, [phoneMode, portraitHeld, videoFullscreen, videoOpen]);
  useEffect(() => { setVideoFullscreen(false); setPortraitHeld(false); }, [videoOpen, selected?.video_id]);
  const immersive = phoneMode && videoOpen && videoFullscreen;
  useEffect(() => { setPhoneImmersive(immersive); }, [immersive]);
  useEffect(() => {
    if (phoneMode && videoOpen && phonePlaying && !videoFullscreen && !portraitHeld && windowSize.width > windowSize.height) setVideoFullscreen(true);
  }, [phoneMode, phonePlaying, portraitHeld, videoFullscreen, videoOpen, windowSize.height, windowSize.width]);
  const toggleVideoFullscreen = useCallback(() => {
    if (videoFullscreen) setPortraitHeld(true);
    setVideoFullscreen(!videoFullscreen);
  }, [videoFullscreen]);
  const openPhoneVideo = useCallback<OpenVideo>((video, context, play, position) => {
    setDetailReturnScreen("/");
    setReturnDestination("/");
    if (screenRef.current !== "detail") setScreen("/");
    openVideo(video, context, play, position);
  }, [openVideo]);
  const phoneSettings = useMemo(() => ({
    instanceUrl, openDetails, phoneLayout: phoneDesign,
    onOpenDetailsChange: async (value: boolean) => { await saveOpenDetails(deviceStore, value); setOpenDetails(value); },
    onPhoneLayoutChange: changePhoneDesign, onChangeInstance: startInstanceChange, onSignOut: signOut,
  }), [changePhoneDesign, instanceUrl, openDetails, phoneDesign, signOut, startInstanceChange]);

  // Phones: Back minimizes the player and returns to where the video was opened.
  const dockPlayer = useCallback(() => {
    setPlayerDocked(true);
    setScreen(detailReturnScreen);
  }, [detailReturnScreen]);
  const expandPlayer = useCallback(() => {
    const current = screenRef.current;
    if (current === "channel" || current === "playlist" || isTvBrowseDestination(current)) setDetailReturnScreen(current);
    setPlayerDocked(false);
    setScreen("detail");
  }, []);
  const closeDockedPlayer = useCallback(() => {
    setPlayerDocked(false);
    if (screenRef.current !== "detail") setSelected(null);
  }, []);
  useEffect(() => { if (!selected) setPlayerDocked(false); }, [selected]);

  let detailContent;
  // A minimized player keeps its details screen mounted, hidden, while the viewer browses.
  if ((screen === "detail" || playerDocked) && api && selected) {
    detailContent = (
      <WatchScreen
        api={api}
        incognito={incognito}
        isChild={profileState?.active.is_child ?? false}
        language={language}
        t={t}
        video={selected}
        queueContext={selectedQueue}
        autoplay={autoplay}
        initialPosition={startPosition}
        onPrimaryFocusTarget={setDetailFocusTarget}
        profileFocusTarget={profileFocusTarget}
        onShowQueue={(target) => { queueReturnFocus.current = target; setQueueVisible(true); }}
        onBack={() => setScreen(detailReturnScreen)}
        onOpenChannel={openChannel}
        onOpenVideo={openVideo}
        onVideoChange={setVideoUpdate}
        onVideoLongPress={openVideoActions}
        playerDocked={playerDocked}
        onDockPlayer={dockPlayer}
        onExpandPlayer={expandPlayer}
        onDockedPlayerClosed={closeDockedPlayer}
        phone={phoneMode}
        playerFullscreen={videoFullscreen}
        onToggleFullscreen={toggleVideoFullscreen}
        onPlayingChange={setPhonePlaying}
      />
    );

  }
  let content;
  if (screen === "profile-selection" && profileState && api) {
    content = <TvProfileMenu key="system-profile-selection" api={api} active={profileState.active} profiles={profileState.profiles}
      canSwitch={profileState.canSwitch} childLockEnabled={profileState.childLockEnabled} incognito={false}
      onIncognitoChange={setIncognito} onTriggerReady={setProfileFocusTarget} onVisibilityChange={setProfileMenuVisible}
      onSwitch={switchProfile} preserveMenuKey={false} t={t}
      selection={{ preferredProfileId, title: t("appleProfilesChoose"), description: !profileState.active.uuid ? t("appleProfilesUpdateServer") : !canRememberSystemProfile ? t("appleProfilesAddUsers") : t("appleProfilesChooseHint"), onCancel: () => { setPairingFromSettings(false); setScreen("instance"); } }} />;
  } else if (screen === "boot") {
    content = bootError
      ? <TvSetupLayout title={t("appleProfilesLoadError")} description={[t("appleProfilesLoadErrorHint"), instanceUrl ? `${t("addressLabel")}: ${instanceUrl}` : ""].filter(Boolean).join("\n\n")} t={t}>
          <TvButton deferPress label={t("refresh")} preferredFocus onPress={() => setBootAttempt((value) => value + 1)} />
          <TvButton deferPress label={t("changeInstance")} variant="ghost" onPress={() => setScreen("instance")} />
        </TvSetupLayout>
      : <View style={styles.boot}><TvLoadingMark accessibilityLabel={t("booting")} size={64} /></View>;
  } else if (screen === "instance") {
    content = (
      <InstanceScreen
        initialValue={pairingInstanceUrl || instanceUrl}
        t={t}
        onConnect={pairingFromSettings ? beginSettingsPairing : beginPairing}
        onBack={pairingFromSettings ? cancelInstanceChange : undefined}
      />
    );
  } else if (screen === "pair" && pairingApi && pairing) {
    content = (
      <PairScreen
        api={pairingApi}
        pairing={pairing}
        t={t}
        onAuthorized={authorize}
        onRetry={retryPairing}
        onChangeInstance={editPairingInstance}
        onBack={pairingFromSettings ? cancelInstanceChange : undefined}
      />
    );
  } else if (browsingScreen === "channel" && api && selectedChannelId) {
    content = (
      <ChannelScreen
        key={[instanceUrl, accessToken, profileState?.active.id, selectedChannelId].join(":")}
        api={api}
        videoUpdate={videoUpdate}
        channelId={selectedChannelId}
        focusRequest={contentFocusRequest}
        language={language}
        profileFocusTarget={profileFocusTarget}
        shortsEnabled={shortsEnabled}
        onBack={closeChannel}
        onPrimaryFocusTarget={setContentFocusTarget}
        onVideoLongPress={openVideoActions}
        t={t}
        viewportWidth={width - sidebarRailWidth}
        viewportHeight={height}
        onOpen={openChannelVideo}
      />
    );
  } else if (browsingScreen === "/settings" && api) {
    content = <SettingsScreen systemProfiles={{ available: systemProfilesNative.available, enabled: systemProfilesEnabled, canRemember: canRememberSystemProfile,
      canLink: Boolean(profileState?.active.uuid),
      linkedName: profileState?.profiles.find((profile) => profile.uuid === linkedProfile?.profileUuid)?.name ?? null,
      isCurrentLinked: Boolean(profileState?.active.uuid && profileState.active.uuid === linkedProfile?.profileUuid),
      onEnabledChange: changeSystemProfilesEnabled, onLinkCurrent: linkCurrentProfile }} openDetails={openDetails} onOpenDetailsChange={async (value) => { await saveOpenDetails(deviceStore, value); setOpenDetails(value); }} phoneDesign={phoneDesignAvailable ? phoneDesign : undefined} onPhoneDesignChange={changePhoneDesign} onPrimaryFocusTarget={setContentFocusTarget} focusRequest={contentFocusRequest} instanceUrl={instanceUrl} profileFocusTarget={profileFocusTarget} t={t} onSignOut={signOut} onChangeInstance={startInstanceChange} />;
  } else if (browsingScreen === "/bookmarks" && api) {
    content = (
      <BookmarksScreen
        key={[instanceUrl, accessToken, profileState?.active.id, browsingScreen].join(":")}
        api={api}
        videoUpdate={videoUpdate}
        focusRequest={contentFocusRequest}
        language={language}
        profileFocusTarget={profileFocusTarget}
        onPrimaryFocusTarget={setContentFocusTarget}
        onVideoLongPress={openVideoActions}
        t={t}
        viewportWidth={width - sidebarRailWidth}
        viewportHeight={height}
        onOpen={openBookmarkVideo}
      />
    );
  } else if (api && (browsingScreen === "/followed-playlists" || browsingScreen === "playlist")) {
    content = <FollowedPlaylistsScreen
      key={[instanceUrl, accessToken, profileState?.active.id, "/followed-playlists"].join(":")}
      api={api} language={language} t={t} selectedId={browsingScreen === "playlist" ? selectedPlaylistId : null}
      focusRequest={contentFocusRequest} profileFocusTarget={profileFocusTarget} onPrimaryFocusTarget={setContentFocusTarget}
      onVideoLongPress={openVideoActions} videoUpdate={videoUpdate}
      viewportWidth={width - sidebarRailWidth} viewportHeight={height}
      onSelect={selectPlaylist}
      onBack={closePlaylist}
      onOpen={openPlaylistVideo}
    />;
  } else if (api && browsingScreen === "/search") {
    content = <SearchScreen key={[instanceUrl, accessToken, profileState?.active.id, "/search"].join(":")}
      api={api} t={t} language={language} focusRequest={contentFocusRequest} profileFocusTarget={topBarTarget ?? profileFocusTarget}
      viewportWidth={width - sidebarRailWidth} viewportHeight={height} onPrimaryFocusTarget={setContentFocusTarget}
      onOpenChannel={openChannelResult} onVideoLongPress={openVideoActions} videoUpdate={videoUpdate}
      onOpen={openSearchVideo} />;
  } else if (api && isTvBrowseDestination(browsingScreen)) {
    content = (
      <FeedScreen
        key={[instanceUrl, accessToken, profileState?.active.id, browsingScreen].join(":")}
        api={api}
        videoUpdate={videoUpdate}
        active={screen === "/" && !queueVisible && !profileMenuVisible && !videoActionRequest && !sidebarExpanded}
        onBackdropChange={backdropController.set}
        onBackdropScroll={backdropScroll}
        destination={browsingScreen}
        focusRequest={contentFocusRequest}
        feedSort={feedSort}
        language={language}
        profileFocusTarget={topBarTarget ?? profileFocusTarget}
        showTopChannels={showTopChannels}
        onPrimaryFocusTarget={setContentFocusTarget}
        onVideoLongPress={openVideoActions}
        t={t}
        viewportWidth={width - sidebarRailWidth}
        viewportHeight={height}
        onSearch={openSearch}
        onOpenChannel={openChannelResult}
        onOpen={openBrowseVideo}
      />
    );
  } else {
    content = <View style={styles.boot}><TvLoadingMark accessibilityLabel={t("booting")} size={64} /></View>;
  }

  return (
    <PhoneScale layout={phoneLayout} style={styles.phoneRoot}>
    <View style={styles.root}>
    {launchRevealing ? <TvFocusScope style={styles.root}>
      {phoneMode && hasShell && api && profileState ? <PhoneApp api={api} t={t} language={language} hidden={screen === "detail"}
        brandName={brandName} brandColor={brandColor} profileName={profileState.active.name} profileColor={profileState.active.avatar_color || colors.accent}
        navConfig={sidebarNav} sort={feedSort} shortsEnabled={shortsEnabled} videoUpdate={videoUpdate} channelRequest={phoneChannelRequest}
        settings={phoneSettings} onOpen={openPhoneVideo} onVideoLongPress={openVideoActions} /> : <>
      {screen !== "detail" && browsingScreen === "/" && api
        ? <TvHomeBackdrop api={api} controller={backdropController} height={height} opacity={backdropOpacity} />
        : null}
      {inShell && shellDestination && (
        <TvSidebar
          brandName={brandName} brandColor={brandColor} onExpandedChange={setSidebarExpanded}
          current={shellDestination}
          navConfig={sidebarNav}
          contentFocusTarget={contentFocusTarget ?? undefined}
          focusable={!shellFocus.pending}
          focusRequest={shellFocus.sidebarRequest}
          onNavigate={navigate}
          t={t}
        />
      )}
      {hasShell ? <TVFocusGuideView ref={setTopBarTarget} autoFocus focusable={screen === "detail" || !shellFocus.pending} style={[styles.topBar, screen === "detail" && styles.detailTopBar]}>
        <View style={styles.accountControls}><TvSurface radius={33}>
        <TvQueueTrigger trigger={queueTrigger} t={t}
          nextFocusDown={(screen === "detail" ? detailFocusTarget : contentFocusTarget) ?? undefined}
          nextFocusRight={profileFocusTarget ?? undefined} onOpen={openQueueFromTopBar} />
      {profileState && api && (
        <TvProfileMenu
          api={api}
          active={profileState.active}
          profiles={profileState.profiles}
          canSwitch={profileState.canSwitch}
          childLockEnabled={profileState.childLockEnabled}
          contentFocusTarget={(screen === "detail" ? detailFocusTarget : contentFocusTarget) ?? undefined}
          incognito={incognito}
          onIncognitoChange={setIncognito}
          onTriggerReady={setProfileFocusTarget}
          onVisibilityChange={setProfileMenuVisible}
          onSwitch={switchProfile}
          preserveMenuKey={screen === "detail" || screen === "playlist" || screen === "channel" || shellDestination === "/settings"}
          t={t}
        />
      )}
      </TvSurface></View></TVFocusGuideView> : null}
      <TVFocusGuideView focusable={screen !== "detail"}
        onFocus={shellFocus.onContentFocus}
        accessibilityElementsHidden={screen === "detail"} importantForAccessibility={screen === "detail" ? "no-hide-descendants" : "auto"}
        style={[styles.content, hasShell && styles.contentWithSidebar, screen === "detail" && styles.hidden]}>
        <TvContentFocusRequests.Provider value={shellFocus.contentFocusAllowed && !queueVisible && !profileMenuVisible && !videoActionRequest}>
          <TvGlassVisibility visible={screen !== "detail"}>
          <TvScreenTransition key={browsingScreen === "playlist" ? "/followed-playlists" : browsingScreen}>{content}</TvScreenTransition>
          </TvGlassVisibility>
        </TvContentFocusRequests.Provider>
      </TVFocusGuideView>
      </>}
      {detailContent ? <View key={`${selected?.video_id}:${videoOpenRequest}`} style={[StyleSheet.absoluteFill, screen !== "detail" && styles.hidden]}
        pointerEvents={screen === "detail" ? "auto" : "none"} accessibilityElementsHidden={screen !== "detail"} importantForAccessibility={screen === "detail" ? "auto" : "no-hide-descendants"}>
        {autoplay ? detailContent : <TvScreenTransition>{detailContent}</TvScreenTransition>}
      </View> : null}
      {api && phoneMode && videoActionRequest ? <PhoneVideoActionSheet key={videoActionRequest.video.video_id}
        actionConfig={videoActionConfig} api={api} t={t} video={videoActionRequest.video}
        onClose={() => setVideoActionRequest(null)} onOpenChannel={openChannel} onRemove={videoActionRequest.options?.onRemove}
        onVideoChange={changeActionVideo} /> : null}
      {api && !phoneMode ? (
        <TvVideoActionMenu
          actionConfig={videoActionConfig}
          api={api}
          onClose={() => setVideoActionRequest(null)}
          onOpenChannel={openChannel}
          onRemove={videoActionRequest?.options?.onRemove}
          onVideoChange={changeActionVideo}
          preserveMenuKey={screen === "detail" || screen === "playlist" || screen === "channel"}
          t={t}
          video={videoActionRequest?.video ?? null}
        />
      ) : null}
      {queueVisible ? <TvQueueSheet t={t} language={language} preserveMenuKey={screen === "playlist" || screen === "detail" || screen === "channel" || screen === "/settings"} onClose={() => { setQueueVisible(false); requestAnimationFrame(() => queueReturnFocus.current?.requestTVFocus()); }} onOpen={(video, _context, play) => {
        if (screen !== "detail") setDetailReturnScreen(screen === "playlist" ? "playlist" : screen === "channel" ? "channel" : returnDestination);
        openVideo(video, selectedQueue?.kind !== "session" && screen === "detail" ? selectedQueue ?? undefined : { version: 1, kind: "feed", sort: feedSort, tags: [], showAll: false }, play);
      }} /> : null}
    </TvFocusScope> : null}
    {launchVisible ? <TvLaunchAnimation ready={screen !== "boot" || bootError} accessibilityLabel={t("booting")}
      onReveal={() => setLaunchRevealing(true)} onFinish={() => setLaunchVisible(false)} /> : null}
    </View>
    </PhoneScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, width: "100%", height: "100%", backgroundColor: colors.background },
  phoneRoot: { backgroundColor: colors.background },
  content: { flex: 1 },
  // Preserve list measurements, scroll offset and mounted cells under AVKit.
  hidden: { opacity: 0 },
  contentWithSidebar: { marginLeft: sidebarRailWidth },
  boot: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  queueTrigger: { paddingHorizontal: 20, minWidth: topBarMetrics.height },
  accountControls: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 4, borderRadius: 33 },
  detailTopBar: { left: topBarMetrics.leading + 100 },
  topBar: { position: "absolute", top: topBarMetrics.top, left: sidebarRailWidth + topBarMetrics.leading + 100, right: topBarMetrics.trailing, height: topBarMetrics.height, zIndex: 91, flexDirection: "row", gap: 24, justifyContent: "flex-end", alignItems: "center" },
});
