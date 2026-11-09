import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

type Host = { show: (node: ReactNode) => void; setOffset: (offset: number) => void; offset: number };
const MiniPlayerSlot = createContext<Host>({ show: () => {}, setOffset: () => {}, offset: 0 });
// Its own context with a stable value: the player refills it on every render.
const PlayerWindowSlot = createContext<(node: ReactNode) => void>(() => {});

/**
 * A slot above the whole app, outside the scaled phone layout, where a
 * minimized player floats while the viewer keeps browsing. A second slot
 * holds a player that covers the whole window.
 */
export function MiniPlayerHost({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  const [windowNode, setWindowNode] = useState<ReactNode>(null);
  const [offset, setOffset] = useState(0);
  return <MiniPlayerSlot.Provider value={{ show: setNode, setOffset, offset }}>
    <PlayerWindowSlot.Provider value={setWindowNode}>
      <View style={styles.fill}>{children}{node}{windowNode ? <View style={StyleSheet.absoluteFill}>{windowNode}</View> : null}</View>
    </PlayerWindowSlot.Provider>
  </MiniPlayerSlot.Provider>;
}

export function useMiniPlayerSlot(): (node: ReactNode) => void {
  return useContext(MiniPlayerSlot).show;
}

/** Shows a full-window player above the app, unscaled; null removes it. */
export function usePlayerWindowSlot(): (node: ReactNode) => void {
  return useContext(PlayerWindowSlot);
}

/** Space a layout keeps at the bottom (a tab bar) that the mini player sits above. */
export function useMiniPlayerOffset(offset: number): void {
  const { setOffset } = useContext(MiniPlayerSlot);
  useEffect(() => { setOffset(offset); return () => setOffset(0); }, [offset, setOffset]);
}

export function useMiniPlayerBottom(): number {
  return useContext(MiniPlayerSlot).offset;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
