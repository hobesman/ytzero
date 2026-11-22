import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { YtZeroApi } from "../api";
import { SidebarIcon } from "../components/SidebarIcon";
import type { Translate } from "../i18n";
import { subscriptionList, type SubscriptionSort } from "../subscriptionList";
import type { Channel } from "../types";
import { PhoneChip } from "./PhoneChip";
import { PhoneListRow } from "./PhoneList";
import { PhoneTextSheet } from "./PhoneTextSheet";
import { phoneColors, phoneType } from "./phoneTheme";
import { useImageSource } from "./useImageSource";

/**
 * The profile's followed channels: filter, sort by name or latest upload, add a
 * channel by URL or handle, and unfollow. Reloads whenever it comes back to the
 * top of the stack, so a follow changed on a channel's page shows here.
 */
export function PhoneSubscriptionsScreen({ api, t, active, onOpenChannel }: {
  api: YtZeroApi; t: Translate; active: boolean; onOpenChannel: (channelId: string) => void;
}) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SubscriptionSort>("name");
  const [adding, setAdding] = useState(false);
  const [unfollowFailed, setUnfollowFailed] = useState(false);
  const source = useImageSource(api);

  const load = useCallback(async () => {
    setFailed(false);
    try { setChannels((await api.channels()).channels); }
    catch { setFailed(true); }
  }, [api]);
  useEffect(() => { if (active) void load(); }, [active, load]);

  const shown = useMemo(() => subscriptionList(channels ?? [], query, sort), [channels, query, sort]);

  const unfollow = useCallback((channel: Channel) => {
    Alert.alert(t("subscriptionsUnfollowTitle").replace("{name}", channel.title), t("subscriptionsUnfollowText"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("unfollow"), style: "destructive", onPress: () => {
        setUnfollowFailed(false);
        setChannels((current) => current?.filter((item) => item.channel_id !== channel.channel_id) ?? current);
        api.followChannel(channel.channel_id, false).catch(() => { setUnfollowFailed(true); void load(); });
      } },
    ]);
  }, [api, load, t]);

  const add = async (url: string) => {
    const added = await api.addChannel(url);
    setAdding(false);
    await load();
    onOpenChannel(added.channel_id);
  };

  if (!channels) return <View style={styles.center}>
    {failed ? <>
      <Text style={styles.muted}>{t("subscriptionsLoadError")}</Text>
      <PhoneChip label={t("tryAgain")} onPress={() => void load()} />
    </> : <ActivityIndicator color={phoneColors.text} size="large" />}
  </View>;

  const header = <View>
    <View style={styles.field}>
      <SidebarIcon name="search" color={phoneColors.textMuted} size={20} />
      <TextInput value={query} onChangeText={setQuery} returnKeyType="search" placeholder={t("subscriptionsFilter")}
        accessibilityLabel={t("subscriptionsFilter")} placeholderTextColor={phoneColors.textMuted} style={styles.input} autoCorrect={false} />
      {query ? <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel={t("searchClear")} onPress={() => setQuery("")}>
        <Text style={styles.clear}>×</Text>
      </Pressable> : null}
    </View>
    <View style={styles.actions}>
      <PhoneChip label={t(sort === "name" ? "subscriptionsSortName" : "subscriptionsSortLatest")}
        onPress={() => setSort((current) => current === "name" ? "latest" : "name")} />
      <PhoneChip label={`+ ${t("subscriptionsAdd")}`} onPress={() => setAdding(true)} />
    </View>
    {unfollowFailed ? <Text accessibilityRole="alert" style={styles.error}>{t("channelFollowError")}</Text> : null}
  </View>;

  return <View style={styles.screen}>
    <FlatList data={shown} keyExtractor={(channel) => channel.channel_id} keyboardShouldPersistTaps="handled" ListHeaderComponent={header}
      ListEmptyComponent={<Text style={[styles.muted, styles.empty]}>{t(channels.length ? "subscriptionsNoMatch" : "subscriptionsEmpty")}</Text>}
      renderItem={({ item }) => {
        const avatar = source(item.thumbnail);
        const detail = [item.handle, item.subscriber_count ? `${item.subscriber_count} ${t("subscribers")}` : ""].filter(Boolean).join(" · ");
        return <PhoneListRow title={item.title} detail={detail || undefined} onPress={() => onOpenChannel(item.channel_id)}
          icon={avatar ? <Image source={avatar} style={styles.avatar} />
            : <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.letter}>{item.title.slice(0, 1)}</Text></View>}
          trailing={<Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel={`${t("unfollow")}: ${item.title}`}
            onPress={() => unfollow(item)} style={styles.more}>
            <Text style={styles.moreGlyph}>⋮</Text>
          </Pressable>} />;
      }}
      initialNumToRender={14} windowSize={9} />
    {adding ? <PhoneTextSheet title={t("subscriptionsAdd")} label={t("subscriptionsAddLabel")} saveLabel={t("follow")}
      error={t("subscriptionsAddError")} maxLength={300} t={t} onSave={add} onClose={() => setAdding(false)} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  field: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginTop: 10, paddingHorizontal: 14, height: 44, borderRadius: 22, backgroundColor: phoneColors.surfaceRaised },
  input: { flex: 1, ...phoneType.body, color: phoneColors.text, paddingVertical: 0 },
  clear: { color: phoneColors.textMuted, fontSize: 24, lineHeight: 26 },
  actions: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  muted: { ...phoneType.body, color: phoneColors.textMuted, textAlign: "center" },
  empty: { paddingHorizontal: 24, paddingTop: 32 },
  error: { ...phoneType.caption, color: phoneColors.danger, paddingHorizontal: 16, paddingBottom: 8 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: phoneColors.surface },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  letter: { ...phoneType.body, fontWeight: "700", color: phoneColors.text },
  more: { width: 32, height: 40, alignItems: "center", justifyContent: "center" },
  moreGlyph: { color: phoneColors.textMuted, fontSize: 22, lineHeight: 24 },
});
