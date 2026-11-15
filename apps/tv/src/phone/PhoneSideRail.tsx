import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SidebarIcon } from "../components/SidebarIcon";
import { landscapeRailWidth } from "../landscapeLayout";
import type { TvNavigationIcon } from "../navigation";
import { phoneColors } from "./phoneTheme";

export type PhoneRailItem<Key extends string> = { key: Key; icon: TvNavigationIcon; label: string };

type Props<Key extends string> = {
  items: PhoneRailItem<Key>[];
  /** The selected tab, or null while a pushed screen covers the tabs. */
  selected: Key | null;
  onSelect: (key: Key) => void;
  /** Above the tabs: the logo, or a back button. */
  top?: ReactNode;
  /** Below the tabs: the account button. */
  bottom?: ReactNode;
};

/**
 * The landscape layout's navigation: the bottom tabs, stood up along the left edge,
 * with targets large enough to hit on a car screen.
 */
export function PhoneSideRail<Key extends string>({ items, selected, onSelect, top, bottom }: Props<Key>) {
  return <View style={styles.rail}>
    {top ? <View style={styles.end}>{top}</View> : null}
    <View style={styles.tabs}>
      {items.map((item) => {
        const active = selected === item.key;
        const color = active ? phoneColors.text : phoneColors.textMuted;
        return <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={item.label}
          onPress={() => onSelect(item.key)} style={({ pressed }) => [styles.tab, active && styles.active, pressed && styles.pressed]}>
          <SidebarIcon name={item.icon} color={color} size={26} />
          <Text numberOfLines={1} style={[styles.label, { color }]}>{item.label}</Text>
        </Pressable>;
      })}
    </View>
    {bottom ? <View style={styles.end}>{bottom}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  rail: { width: landscapeRailWidth, paddingVertical: 8, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: phoneColors.divider, backgroundColor: phoneColors.background },
  end: { height: 56, alignItems: "center", justifyContent: "center" },
  tabs: { flex: 1, justifyContent: "center", gap: 4 },
  tab: { minHeight: 68, marginHorizontal: 8, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 4 },
  active: { backgroundColor: phoneColors.surfaceRaised },
  pressed: { opacity: 0.6 },
  label: { fontSize: 12, fontWeight: "600" },
});
