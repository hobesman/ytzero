import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View, type ImageSourcePropType } from "react-native";
import type { YtZeroApi } from "../api";
import { SidebarIcon } from "../components/SidebarIcon";
import type { Translate } from "../i18n";
import type { OpenVideo } from "../playbackQueue";
import type { Channel, Language, Video } from "../types";
import { PhoneListRow } from "./PhoneList";
import { PhoneVideoCard } from "./PhoneVideoCard";
import { phoneColors, phoneType } from "./phoneTheme";

type Row = { kind: "heading"; key: string; title: string } | { kind: "video"; key: string; video: Video } | { kind: "channel"; key: string; channel: Channel } | { kind: "note"; key: string; text: string };

/** Searches the library and YouTube together, library results first. */
export function PhoneSearchScreen({ api, language, t, onOpen, onOpenChannel }: { api: YtZeroApi; language: Language; t: Translate; onOpen: OpenVideo; onOpenChannel: (channelId: string) => void }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [searching, setSearching] = useState(false);
  const request = useRef(0);
  const sources = useRef(new Map<string, ImageSourcePropType>());
  const source = useCallback((url: string | null | undefined): ImageSourcePropType | null => {
    if (!url) return null;
    let cached = sources.current.get(url);
    if (!cached) { cached = api.thumbnailSource(url) as ImageSourcePropType; sources.current.set(url, cached); }
    return cached;
  }, [api]);

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    const id = ++request.current;
    setSearching(true);
    setRows([]);
    const [local, youtube] = await Promise.allSettled([api.searchLocal(q), api.searchYoutube(q)]);
    if (id !== request.current) return;
    const next: Row[] = [];
    // Channels from the library first, then YouTube, without duplicates.
    const channels = new Map<string, Channel>();
    for (const result of [local, youtube]) if (result.status === "fulfilled") for (const channel of result.value.channels) if (!channels.has(channel.channel_id)) channels.set(channel.channel_id, channel);
    if (channels.size) {
      next.push({ kind: "heading", key: "channels", title: t("searchChannels") });
      for (const channel of [...channels.values()].slice(0, 6)) next.push({ kind: "channel", key: `channel:${channel.channel_id}`, channel });
    }
    const section = (key: string, title: string, result: PromiseSettledResult<{ videos: Video[]; channels: Channel[] }>) => {
      next.push({ kind: "heading", key, title });
      if (result.status === "rejected") next.push({ kind: "note", key: `${key}:error`, text: t("searchError") });
      else if (result.value.videos.length === 0) next.push({ kind: "note", key: `${key}:empty`, text: "—" });
      else result.value.videos.forEach((video) => next.push({ kind: "video", key: `${key}:${video.video_id}`, video }));
    };
    section("library", t("searchLibrary"), local);
    section("youtube", t("searchYoutube"), youtube);
    setRows(next);
    setSearching(false);
  }, [api, query, t]);

  const open = useCallback((video: Video) => onOpen(video, undefined, true), [onOpen]);
  return <View style={styles.screen}>
    <View style={styles.field}>
      <SidebarIcon name="search" color={phoneColors.textMuted} size={20} />
      <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} returnKeyType="search"
        placeholder={t("searchHint")} placeholderTextColor={phoneColors.textMuted} style={styles.input} autoCorrect={false} />
      {query ? <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel={t("searchClear")} onPress={() => { setQuery(""); setRows([]); request.current++; setSearching(false); }}>
        <Text style={styles.clear}>×</Text>
      </Pressable> : null}
    </View>
    {searching ? <View style={styles.status}><ActivityIndicator color={phoneColors.text} /><Text style={styles.note}>{t("searchLoading")}</Text></View> : null}
    <FlatList data={rows} keyExtractor={(row) => row.key} keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => item.kind === "heading" ? <Text style={styles.heading}>{item.title}</Text>
        : item.kind === "channel" ? <PhoneListRow title={item.channel.title} detail={item.channel.handle ?? undefined} onPress={() => onOpenChannel(item.channel.channel_id)}
            icon={source(item.channel.thumbnail) ? <Image source={source(item.channel.thumbnail)!} style={styles.channelAvatar} /> : undefined} />
        : item.kind === "note" ? <Text style={[styles.note, styles.rowNote]}>{item.text}</Text>
        : <PhoneVideoCard video={item.video} language={language} t={t} onPress={open}
            thumbnail={source(item.video.thumbnail)!} channelAvatar={source(item.video.channel_thumbnail)} />}
      initialNumToRender={4} windowSize={7} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  field: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginVertical: 10, paddingHorizontal: 14, height: 44, borderRadius: 22, backgroundColor: phoneColors.surfaceRaised },
  input: { flex: 1, ...phoneType.body, color: phoneColors.text, paddingVertical: 0 },
  clear: { color: phoneColors.textMuted, fontSize: 24, lineHeight: 26 },
  status: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16 },
  heading: { ...phoneType.section, color: phoneColors.text, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  note: { ...phoneType.body, color: phoneColors.textMuted },
  rowNote: { paddingHorizontal: 16, paddingBottom: 12 },
  channelAvatar: { width: 26, height: 26, borderRadius: 13 },
});
