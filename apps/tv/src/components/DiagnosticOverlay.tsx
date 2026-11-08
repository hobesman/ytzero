import { useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { clearDiagnostics, diagnosticEntries, subscribeDiagnostics } from "../diagnosticLog";
import { useCompactLayout } from "../useCompactLayout";

/** Temporary phone-only event log for the Android probe; see diagnosticLog.ts. */
export function DiagnosticOverlay() {
  const compact = useCompactLayout();
  const entries = useSyncExternalStore(subscribeDiagnostics, diagnosticEntries);
  const [collapsed, setCollapsed] = useState(false);
  if (!compact || entries.length === 0) return null;
  if (collapsed) return <Pressable style={[styles.panel, styles.collapsed]} onPress={() => setCollapsed(false)}><Text style={styles.text}>diag ({entries.length})</Text></Pressable>;
  return <View style={styles.panel}>
    <View style={styles.actions}>
      <Text style={styles.heading}>Diagnostics</Text>
      <Pressable onPress={clearDiagnostics} hitSlop={8}><Text style={styles.action}>Clear</Text></Pressable>
      <Pressable onPress={() => setCollapsed(true)} hitSlop={8}><Text style={styles.action}>Hide</Text></Pressable>
    </View>
    <ScrollView style={styles.scroll}>
      {entries.map((entry) => <Text key={entry.id} style={styles.text} selectable>{entry.time} {entry.message}</Text>)}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  panel: { position: "absolute", left: 8, right: 8, bottom: 8, maxHeight: "45%", backgroundColor: "rgba(0,0,0,0.85)", borderRadius: 10, padding: 8, zIndex: 1000, elevation: 1000 },
  collapsed: { left: undefined, right: 8, paddingVertical: 4 },
  actions: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 4 },
  heading: { flex: 1, color: "#ffd60a", fontSize: 12, fontWeight: "700" },
  action: { color: "#4d8cff", fontSize: 12, fontWeight: "700" },
  scroll: { flexGrow: 0 },
  text: { color: "#f5f5f7", fontSize: 11, lineHeight: 14, fontFamily: "monospace" },
});
