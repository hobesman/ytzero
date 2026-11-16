import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { useLowResource } from "./lowResource";
import { getIncreasedContrast, observeIncreasedContrast } from "./systemAppearance";

export const motion = {
  focus: { damping: 24, stiffness: 300, mass: 0.8 },
  enter: 340,
  exit: 160,
  cardScale: 1.045,
  buttonScale: 1.045,
};

const ReducedMotion = createContext(true);
const ReducedTransparency = createContext(false);
const IncreasedContrast = createContext(false);
const MotionReady = createContext(false);

/** One system subscription for every focus target and transition in the app. */
export function TvMotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(true);
  const [opaque, setOpaque] = useState(false);
  const [contrast, setContrast] = useState(false);
  const [ready, setReady] = useState(false);
  // Low-resource mode turns animation and blurred glass off, as the system settings would.
  const low = useLowResource();
  useEffect(() => {
    let active = true;
    let changed = false;
    let transparencyChanged = false;
    let contrastChanged = false;
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      changed = true;
      if (active) setReduced(value);
    });
    const transparency = AccessibilityInfo.addEventListener("reduceTransparencyChanged", (value) => {
      transparencyChanged = true; if (active) setOpaque(value);
    });
    const contrastListener = observeIncreasedContrast((value) => {
      contrastChanged = true; if (active) setContrast(value);
    });
    void AccessibilityInfo.isReduceTransparencyEnabled().then((value) => { if (active && !transparencyChanged) setOpaque(value); }).catch(() => {});
    void getIncreasedContrast().then((value) => { if (active && !contrastChanged) setContrast(value); }).catch(() => {});
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active && !changed) setReduced(value);
    }).catch(() => {}).finally(() => { if (active) setReady(true); });
    return () => { active = false; listener.remove(); transparency.remove(); contrastListener.remove(); };
  }, []);
  return <MotionReady.Provider value={ready}><ReducedMotion.Provider value={reduced || low}><ReducedTransparency.Provider value={opaque || low}><IncreasedContrast.Provider value={contrast}>{children}</IncreasedContrast.Provider></ReducedTransparency.Provider></ReducedMotion.Provider></MotionReady.Provider>;
}

export const useReducedMotion = () => useContext(ReducedMotion);
export const useMotionReady = () => useContext(MotionReady);
export const useReducedTransparency = () => useContext(ReducedTransparency);
export const useIncreasedContrast = () => useContext(IncreasedContrast);

export function useTvScale(focused: boolean, pressed = false, focusScale = motion.buttonScale) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    scale.stopAnimation();
    if (reduced) { scale.setValue(1); return; }
    const animation = Animated.spring(scale, {
      toValue: pressed ? 0.985 : focused ? focusScale : 1,
      ...motion.focus,
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [focusScale, focused, pressed, reduced, scale]);
  return scale;
}
