import { createContext, useContext, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

const MiniPlayerSlot = createContext<(node: ReactNode) => void>(() => {});

/**
 * A slot above the whole app, outside the scaled phone layout, where a
 * minimized player floats while the viewer keeps browsing.
 */
export function MiniPlayerHost({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  return <MiniPlayerSlot.Provider value={setNode}>
    <View style={styles.fill}>{children}{node}</View>
  </MiniPlayerSlot.Provider>;
}

export function useMiniPlayerSlot(): (node: ReactNode) => void {
  return useContext(MiniPlayerSlot);
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
