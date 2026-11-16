import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Translate } from "../i18n";
import { musicPlayer } from "../musicPlayer";
import { PhoneChip } from "../phone/PhoneChip";
import { phoneColors, phoneType } from "../phone/phoneTheme";
import type { MusicApi, MusicLyrics, MusicTrack } from "./musicApi";
import { currentLyricIndex } from "./musicLyrics";
import type { MusicSession } from "./musicSession";

type Loaded = { videoId: string; lyrics: MusicLyrics | null; failed: boolean };

/** The player's position, read often enough to move from line to line in time. */
function useFinePosition(active: boolean) {
  const [position, setPosition] = useState(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const read = () => { void musicPlayer.getState().then((player) => { if (live && player) setPosition(player.position); }); };
    read();
    const timer = setInterval(read, 300);
    return () => { live = false; clearInterval(timer); };
  }, [active]);
  return position;
}

function SyncedLines({ lines, session, height }: { lines: NonNullable<MusicLyrics["synced"]>; session: MusicSession; height: number }) {
  const position = useFinePosition(true);
  const index = currentLyricIndex(lines, position);
  const scroller = useRef<ScrollView>(null);
  const offsets = useRef(new Map<number, { y: number; height: number }>());
  useEffect(() => {
    const line = offsets.current.get(Math.max(0, index));
    if (line) scroller.current?.scrollTo({ y: Math.max(0, line.y - height / 2 + line.height / 2), animated: true });
  }, [height, index]);
  return <ScrollView ref={scroller} nestedScrollEnabled style={{ height }} contentContainerStyle={styles.lines} showsVerticalScrollIndicator={false}>
    {lines.map((line, at) => <Pressable key={`${at}:${line.time}`} accessibilityRole="button" accessibilityState={{ selected: at === index }}
      onLayout={(event) => offsets.current.set(at, event.nativeEvent.layout)} onPress={() => session.seekTo(line.time)}>
      <Text style={[styles.line, at < index && styles.past, at === index && styles.current]}>{line.text || "♪"}</Text>
    </Pressable>)}
  </ScrollView>;
}

/**
 * The playing song's lyrics, in place of the artwork: synced lines follow the
 * song and can be tapped to jump there; otherwise the plain text scrolls.
 */
export function MusicLyricsView({ api, session, t, track, height }: { api: MusicApi; session: MusicSession; t: Translate; track: MusicTrack; height: number }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoaded(null);
    api.lyrics(track.videoId).then(
      (lyrics) => { if (live) setLoaded({ videoId: track.videoId, lyrics, failed: false }); },
      () => { if (live) setLoaded({ videoId: track.videoId, lyrics: null, failed: true }); },
    );
    return () => { live = false; };
  }, [api, attempt, track.videoId]);
  const shown = loaded?.videoId === track.videoId ? loaded : null;
  const lyrics = shown?.lyrics ?? null;
  const source = lyrics?.source ? (lyrics.source === "LRCLIB" ? t("musicLyricsFrom").replace("{source}", "LRCLIB") : lyrics.source) : null;
  const note = (text: string, retry?: boolean) => <View style={[styles.note, { height }]}>
    <Text style={styles.noteText}>{text}</Text>
    {retry ? <PhoneChip label={t("musicRetry")} onPress={() => setAttempt((count) => count + 1)} /> : null}
  </View>;
  return <View style={styles.box}>
    {!shown ? <View style={[styles.note, { height }]}><ActivityIndicator color={phoneColors.textMuted} /></View>
      : shown.failed ? note(t("musicLyricsFailed"), true)
      : lyrics?.synced ? <SyncedLines lines={lyrics.synced} session={session} height={height} />
      : lyrics?.plain ? <ScrollView nestedScrollEnabled style={{ height }} contentContainerStyle={styles.lines}><Text style={styles.plain}>{lyrics.plain}</Text></ScrollView>
      : note(lyrics?.instrumental ? t("musicLyricsInstrumental") : t("musicLyricsNone"))}
    {source && (lyrics?.synced || lyrics?.plain) ? <Text style={styles.source}>{source}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  box: { alignSelf: "stretch", borderRadius: 12, backgroundColor: phoneColors.surface, overflow: "hidden" },
  lines: { paddingHorizontal: 16, paddingVertical: 12, gap: 6 },
  line: { ...phoneType.title, fontSize: 19, lineHeight: 26, color: phoneColors.textMuted, opacity: 0.6 },
  past: { opacity: 0.8 },
  current: { color: phoneColors.text, opacity: 1 },
  plain: { ...phoneType.body, fontSize: 16, lineHeight: 24, color: phoneColors.text },
  note: { alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  noteText: { ...phoneType.body, color: phoneColors.textMuted, textAlign: "center" },
  source: { ...phoneType.caption, color: phoneColors.textMuted, paddingHorizontal: 16, paddingBottom: 10, paddingTop: 2 },
});
