import { createContext, useContext, type ReactNode } from "react";
import { Platform, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";
import { phoneCanvas, type PhoneCanvas } from "../phoneCanvas";

type ScreenSize = { width: number; height: number; fontScale: number };
const ScreenSizeContext = createContext<ScreenSize | null>(null);

/** The size layouts should design for: the phone canvas when scaled, else the window. */
export function useScreenSize(): ScreenSize {
  const window = useWindowDimensions();
  return useContext(ScreenSizeContext) ?? window;
}

const noInsets: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export type PhoneScaleLayout = { canvas: PhoneCanvas | null; insets: EdgeInsets; size: ScreenSize };

/**
 * Measures the phone canvas. Full-screen surfaces keep clear of the system bars;
 * an overlay (`insets: false`) covers the whole window behind its own panel.
 */
export function usePhoneScale(enabled = true, insets = true): PhoneScaleLayout {
  const window = useWindowDimensions();
  const safe = useSafeAreaInsets();
  const edges = insets && Platform.OS === "android" && !Platform.isTV ? safe : noInsets;
  const width = window.width - edges.left - edges.right;
  const height = window.height - edges.top - edges.bottom;
  const canvas = enabled ? phoneCanvas(width, height, Platform.isTV) : null;
  return {
    canvas, insets: edges,
    size: canvas ? { width: canvas.width, height: canvas.height, fontScale: window.fontScale } : { width, height, fontScale: window.fontScale },
  };
}

/** Draws the TV layout scaled down on phones; renders children unchanged elsewhere. */
export function PhoneScale({ layout, style, children }: { layout: PhoneScaleLayout; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const { canvas, insets, size } = layout;
  const padding = { paddingTop: insets.top, paddingRight: insets.right, paddingBottom: insets.bottom, paddingLeft: insets.left };
  if (!canvas) return <View style={[styles.fill, padding, style]}>{children}</View>;
  return <View style={[styles.fill, padding, style]}>
    <View style={styles.clip}>
      <View style={{ width: canvas.width, height: canvas.height, transformOrigin: "0 0", transform: [{ scale: canvas.scale }] }}>
        <ScreenSizeContext.Provider value={size}>{children}</ScreenSizeContext.Provider>
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  clip: { flex: 1, overflow: "hidden" },
});

/** A full-window Modal's content, scaled like the screen behind it. */
export function PhoneOverlayScale({ children }: { children: ReactNode }) {
  return <PhoneScale layout={usePhoneScale(true, false)}>{children}</PhoneScale>;
}
