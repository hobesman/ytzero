import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

type Host = { show: (node: ReactNode) => void; setOffset: (offset: number) => void; offset: number };
const MiniPlayerSlot = createContext<Host>({ show: () => {}, setOffset: () => {}, offset: 0 });

/**
 * A slot above the whole app, outside the scaled phone layout, where a
 * minimized player floats while the viewer keeps browsing.
 */
export function MiniPlayerHost({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  const [offset, setOffset] = useState(0);
  return <MiniPlayerSlot.Provider value={{ show: setNode, setOffset, offset }}>
    <View style={styles.fill}>{children}{node}</View>
  </MiniPlayerSlot.Provider>;
}

export function useMiniPlayerSlot(): (node: ReactNode) => void {
  return useContext(MiniPlayerSlot).show;
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
