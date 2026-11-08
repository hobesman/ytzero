import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  findNodeHandle,
  Platform,
  ScrollView,
  StyleSheet,
  TVFocusGuideView,
  View,
  type FocusDestination,
} from "react-native";
import { requestTvFocus } from "../focus";
import type { Translate } from "../i18n";
import { motion, useReducedMotion } from "../motion";
import { resolveTvNavigation, type TvDestination, type TvNavigationIcon, type TvNavigationItem } from "../navigation";
import { colors, typography, sidebarExpandedWidth, sidebarRailWidth } from "../theme";
import { LogoMark } from "./Logo";
import { SidebarIcon } from "./SidebarIcon";
import { TvPressable } from "./TvPressable";
import { TvControlSurface, TvSurface } from "./TvSurface";

type Props = {
  brandName: string;
  brandColor: string;
  onExpandedChange: (expanded: boolean) => void;
  current: TvDestination;
  navConfig: string;
  contentFocusTarget?: FocusDestination;
  focusable?: boolean;
  focusRequest?: number;
  onNavigate: (destination: TvDestination) => void;
  t: Translate;
};

type SidebarEntryProps = {
  itemKey: string;
  icon: TvNavigationIcon | "more";
  label: string;
  active?: boolean;
  focusable: boolean;
  disclosureExpanded?: boolean;
  nextFocusRight?: FocusDestination;
  labelOpacity: Animated.AnimatedInterpolation<number>;
  labelTranslateX: Animated.AnimatedInterpolation<number>;
  destination?: TvDestination;
  onActivate?: () => void;
  onNavigate: (destination: TvDestination) => void;
  onOpen: (key: string) => void;
  onClose: () => void;
  onTarget: (key: string, target: View | null) => void;
};

/** Focus is local to an entry so moving through navigation does not repaint
 * every icon, label and glass fill in the sidebar. */
const SidebarEntry = memo(function SidebarEntry({
  itemKey,
  icon,
  label,
  active = false,
  focusable,
  disclosureExpanded,
  nextFocusRight,
  labelOpacity,
  labelTranslateX,
  destination,
  onActivate,
  onNavigate,
  onOpen,
  onClose,
  onTarget,
}: SidebarEntryProps) {
  const captureTarget = useCallback((target: View | null) => {
    onTarget(itemKey, target);
  }, [itemKey, onTarget]);
  const handleFocus = useCallback(() => {
    onOpen(itemKey);
  }, [itemKey, onOpen]);
  const handleBlur = useCallback(() => {
    onClose();
  }, [onClose]);
  const handlePress = useCallback(() => {
    if (destination) onNavigate(destination);
    else onActivate?.();
  }, [destination, onActivate, onNavigate]);

  return (
    <TvPressable
      ref={captureTarget}
      deferPress={Boolean(destination)}
      focusScale={1.015}
      focusable={focusable}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={disclosureExpanded === undefined ? { selected: active } : { expanded: disclosureExpanded }}
      nextFocusRight={nextFocusRight}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPress={handlePress}
      style={styles.item}
    >
      {({ focused }) => {
        const visibleFocus = focusable && focused;
        const iconColor = visibleFocus || active ? colors.text : colors.textMuted;
        return <>
          <TvControlSurface focused={visibleFocus} filled={false} radius={33} />
          <View style={styles.iconSlot}>
            <View style={[styles.iconTile, active && styles.iconTileActive, visibleFocus && styles.iconTileFocused]}>
              <SidebarIcon name={icon} color={iconColor} />
            </View>
          </View>
          <Animated.Text numberOfLines={1} style={[styles.label, {
            color: iconColor,
            opacity: labelOpacity,
            transform: [{ translateX: labelTranslateX }],
          }]}>
            {label}
          </Animated.Text>
        </>;
      }}
    </TvPressable>
  );
});

export function TvSidebar({ brandName, brandColor, onExpandedChange, current, navConfig, contentFocusTarget, focusable = true, focusRequest = 0, onNavigate, t }: Props) {
  const navigation = useMemo(() => resolveTvNavigation(navConfig), [navConfig]);
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  const [showHidden, setShowHidden] = useState(false);
  const targets = useRef(new Map<string, View>());
  const visibleEntries = useMemo(
    () => showHidden ? [...navigation.visible, ...navigation.hidden] : navigation.visible,
    [navigation, showHidden],
  );
  const entryKey = visibleEntries.find((item) => item.destination === current)?.key ?? "more";
  const [entryTarget, setEntryTarget] = useState<View | null>(null);
  useEffect(() => {
    setEntryTarget(targets.current.get(entryKey) ?? null);
  }, [entryKey, navigation]);

  const contentFocusHandle = typeof contentFocusTarget === "number"
    ? contentFocusTarget
    : contentFocusTarget ? findNodeHandle(contentFocusTarget) ?? undefined : undefined;
  const progress = useRef(new Animated.Value(0)).current;
  const clipWidth = useRef(new Animated.Value(sidebarRailWidth)).current;
  const reduced = useReducedMotion();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animateNextExpansion = useRef(true);
  const handledFocusRequest = useRef(focusRequest);
  const expandedChange = useRef(onExpandedChange);
  expandedChange.current = onExpandedChange;

  const clearCloseTimer = useCallback(() => {
    if (!closeTimer.current) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const registerTarget = useCallback((key: string, target: View | null) => {
    if (target) targets.current.set(key, target);
    else targets.current.delete(key);
  }, []);
  const updateExpanded = useCallback((next: boolean, animate = true) => {
    if (!animate) {
      clipWidth.stopAnimation();
      progress.stopAnimation();
      clipWidth.setValue(next ? sidebarExpandedWidth : sidebarRailWidth);
      progress.setValue(next ? 1 : 0);
    }
    if (expandedRef.current === next) return;
    expandedRef.current = next;
    animateNextExpansion.current = animate;
    setExpanded(next);
  }, [clipWidth, progress]);
  const open = useCallback((_key: string) => {
    if (!focusable) return;
    clearCloseTimer();
    updateExpanded(true);
  }, [clearCloseTimer, focusable, updateExpanded]);
  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      updateExpanded(false);
    }, 120);
  }, [clearCloseTimer, updateExpanded]);
  const navigate = useCallback((destination: TvDestination) => {
    clearCloseTimer();
    // Collapse before mounting the destination so its entry animation starts
    // from the final content bounds.
    updateExpanded(false, false);
    onNavigate(destination);
  }, [clearCloseTimer, onNavigate, updateExpanded]);
  const toggleHidden = useCallback(() => setShowHidden((value) => !value), []);

  useEffect(() => {
    if (!focusable) {
      clearCloseTimer();
      updateExpanded(false, false);
    }
  }, [clearCloseTimer, focusable, updateExpanded]);
  useEffect(() => {
    if (!focusable || !entryTarget || handledFocusRequest.current === focusRequest) return;
    handledFocusRequest.current = focusRequest;
    const frame = requestAnimationFrame(() => { void requestTvFocus(entryTarget); });
    return () => cancelAnimationFrame(frame);
  }, [entryTarget, focusable, focusRequest]);
  useEffect(() => { expandedChange.current(expanded); }, [expanded]);
  useEffect(() => () => { expandedChange.current(false); }, []);

  useEffect(() => {
    clipWidth.stopAnimation();
    progress.stopAnimation();
    const animate = animateNextExpansion.current;
    animateNextExpansion.current = true;
    if (reduced || !animate) {
      clipWidth.setValue(expanded ? sidebarExpandedWidth : sidebarRailWidth);
      progress.setValue(expanded ? 1 : 0);
      return;
    }
    // Only the clipping viewport changes size. The Liquid Glass material below
    // keeps expanded bounds, avoiding a blur re-layout on every animation frame.
    const reveal = Animated.timing(clipWidth, {
      toValue: expanded ? sidebarExpandedWidth : sidebarRailWidth,
      duration: 210,
      easing: Easing.inOut(Easing.ease),
      isInteraction: false,
      useNativeDriver: false,
    });
    const labels = Animated.spring(progress, {
      toValue: expanded ? 1 : 0,
      ...motion.focus,
      isInteraction: false,
      useNativeDriver: true,
    });
    reveal.start();
    labels.start();
    return () => { reveal.stop(); labels.stop(); };
  }, [clipWidth, expanded, progress, reduced]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  // Keep labels hidden until the expanding material is behind most of them.
  const labelOpacity = useMemo(() => progress.interpolate({
    inputRange: [0, 0.52, 1],
    outputRange: [0, 0, 1],
    extrapolate: "clamp",
  }), [progress]);
  const labelTranslateX = useMemo(() => progress.interpolate({
    inputRange: [0, 0.52, 1],
    outputRange: [-10, -10, 0],
    extrapolate: "clamp",
  }), [progress]);

  const entry = (item: TvNavigationItem) => (
    <SidebarEntry
      key={item.key}
      itemKey={item.key}
      icon={item.icon}
      label={t(item.labelKey)}
      active={current === item.destination}
      focusable={focusable}
      nextFocusRight={contentFocusHandle}
      labelOpacity={labelOpacity}
      labelTranslateX={labelTranslateX}
      destination={item.destination}
      onNavigate={navigate}
      onOpen={open}
      onClose={scheduleClose}
      onTarget={registerTarget}
    />
  );

  return (
    <>
      <Animated.View pointerEvents="box-none" style={[styles.sidebar, { width: clipWidth }]}>
        <View style={styles.material}>
        <TvSurface radius={40}>
          <TVFocusGuideView autoFocus focusable={focusable} destinations={!expanded && entryTarget ? [entryTarget] : undefined} trapFocusLeft style={styles.focusGuide}>
            <View style={styles.brand}>
              <View style={styles.iconSlot}><LogoMark size={38} color={brandColor} accessibilityLabel={brandName} /></View>
              <Animated.Text numberOfLines={2} style={[styles.brandName, { opacity: labelOpacity, transform: [{ translateX: labelTranslateX }] }]}>{brandName}</Animated.Text>
            </View>
            {/* A touch screen scrolls the rail itself; on a TV, focus scrolls it. */}
            <ScrollView pointerEvents={Platform.isTV ? "box-none" : "auto"} showsVerticalScrollIndicator={false} contentContainerStyle={styles.navigation}>
              {navigation.visible.map(entry)}
              {navigation.hidden.length > 0 && (
                <>
                  <SidebarEntry
                    itemKey="more"
                    icon="more"
                    label={showHidden ? t("less") : t("more")}
                    focusable={focusable}
                    disclosureExpanded={showHidden}
                    nextFocusRight={contentFocusHandle}
                    labelOpacity={labelOpacity}
                    labelTranslateX={labelTranslateX}
                    onActivate={toggleHidden}
                    onNavigate={navigate}
                    onOpen={open}
                    onClose={scheduleClose}
                    onTarget={registerTarget}
                  />
                  {showHidden && navigation.hidden.map(entry)}
                </>
              )}
            </ScrollView>
          </TVFocusGuideView>
        </TvSurface>
        </View>
      </Animated.View>
      {focusable && !expanded && entryTarget && (
        <TVFocusGuideView destinations={[entryTarget]} style={styles.sidebarFocusBridge} />
      )}
      {focusable && expanded && contentFocusTarget && (
        <TVFocusGuideView destinations={[contentFocusTarget]} style={styles.contentFocusBridge} />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    position: "absolute",
    zIndex: 100,
    left: 24,
    top: 32,
    bottom: 32,
    borderRadius: 40,
    overflow: "hidden",
    shadowColor: colors.black,
    shadowOpacity: 0.58,
    shadowRadius: 30,
    shadowOffset: { width: 16, height: 0 },
  },
  material: { flex: 1, width: sidebarExpandedWidth },
  contentFocusBridge: { position: "absolute", zIndex: 101, left: sidebarExpandedWidth + 24, top: 0, bottom: 0, width: 240 },
  sidebarFocusBridge: { position: "absolute", zIndex: 101, left: sidebarRailWidth + 24, top: 0, bottom: 0, width: 48 },
  focusGuide: { flex: 1, width: sidebarExpandedWidth },
  brand: { width: sidebarExpandedWidth, height: 108, paddingHorizontal: 18, flexDirection: "row", alignItems: "center" },
  brandName: { flex: 1, paddingRight: 24, color: colors.text, fontSize: 26, fontWeight: "700", letterSpacing: -0.8 },
  navigation: { width: sidebarExpandedWidth, paddingHorizontal: 18, paddingBottom: 30, gap: 6 },
  item: { minHeight: 66, borderRadius: 33, flexDirection: "row", alignItems: "center", overflow: "hidden" },
  iconSlot: { width: 79, alignItems: "center", justifyContent: "center" },
  iconTile: { width: 50, height: 50, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  iconTileActive: { backgroundColor: colors.surfaceSelected },
  iconTileFocused: { backgroundColor: "transparent" },
  label: { flex: 1, paddingRight: 24, fontSize: typography.caption.fontSize, fontWeight: "600" },
});
