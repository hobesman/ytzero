import { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { YtZeroApi } from "../api";
import type { Translate } from "../i18n";
import type { VideoComment } from "../types";
import { PhoneChip } from "./PhoneChip";
import { phoneColors, phoneType } from "./phoneTheme";

const preview = 3;

/** A video's comments on the phone details page: loaded on request or automatically, three at first. */
export function PhoneComments({ api, comments, loading, error, t, onLoad }: {
  api: YtZeroApi; comments: VideoComment[] | null; loading: boolean; error: boolean; t: Translate; onLoad: () => void;
}) {
  const [all, setAll] = useState(false);
  const shown = comments ? all ? comments : comments.slice(0, preview) : [];
  return <View style={styles.section}>
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={styles.title}>{t("commentsTitle")}</Text>
      {loading ? <ActivityIndicator color={phoneColors.textMuted} accessibilityLabel={t("loadingComments")} />
        : comments === null || error ? <PhoneChip label={error ? t("tryAgain") : t("loadComments")} onPress={onLoad} /> : null}
    </View>
    {error ? <Text style={styles.muted}>{t("commentsLoadError")}</Text> : null}
    {comments?.length === 0 ? <Text style={styles.muted}>{t("commentsEmpty")}</Text> : null}
    {shown.map((comment) => <Comment key={comment.id} api={api} comment={comment} t={t} />)}
    {comments && comments.length > preview && !all ? <Pressable accessibilityRole="button" onPress={() => setAll(true)} style={styles.more}>
      <Text style={styles.moreText}>{`${t("commentsTitle")} · ${comments.length}`}</Text>
    </Pressable> : null}
  </View>;
}

function Comment({ api, comment, t }: { api: YtZeroApi; comment: VideoComment; t: Translate }) {
  const [expanded, setExpanded] = useState(false);
  const avatar = comment.authorThumbnail ? api.thumbnailSource(comment.authorThumbnail) : null;
  const flags = [comment.isPinned ? t("pinnedComment") : "", comment.authorIsUploader ? t("creatorComment") : "", comment.timeText ?? ""].filter(Boolean);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${comment.author}: ${comment.text}`} onPress={() => setExpanded((value) => !value)} style={styles.comment}>
    {avatar ? <Image source={avatar} style={styles.avatar} /> : <View style={styles.avatar} />}
    <View style={styles.copy}>
      <Text numberOfLines={1} style={styles.meta}>{[comment.author, ...flags].join(" · ")}</Text>
      <Text numberOfLines={expanded ? undefined : 4} style={styles.text}>{comment.text}</Text>
      {comment.likeCount > 0 ? <Text style={styles.meta}>{`♥ ${comment.likeCount}`}</Text> : null}
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  section: { paddingTop: 20 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  title: { ...phoneType.section, color: phoneColors.text },
  muted: { ...phoneType.body, color: phoneColors.textMuted, paddingHorizontal: 16, paddingVertical: 6 },
  comment: { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: phoneColors.surfaceRaised },
  copy: { flex: 1, gap: 3 },
  meta: { ...phoneType.caption, color: phoneColors.textMuted },
  text: { ...phoneType.body, color: phoneColors.text },
  more: { marginHorizontal: 16, marginTop: 4, paddingVertical: 10, alignItems: "center", borderRadius: 12, backgroundColor: phoneColors.surface },
  moreText: { ...phoneType.body, fontWeight: "600", color: phoneColors.text },
});
