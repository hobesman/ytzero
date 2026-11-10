import { StyleSheet, Text, View } from "react-native";
import type { YtZeroApi } from "../api";
import { TvButton } from "../components/TvButton";
import type { Translate } from "../i18n";
import type { Language, Video } from "../types";
import { viewDownloads } from "../phoneDownloads";
import { usePhoneDownloads } from "../usePhoneDownloads";
import { PhoneChip } from "./PhoneChip";
import { PhoneDownloadsScreen } from "./PhoneDownloadsScreen";
import { phoneColors, phoneMetrics, phoneType } from "./phoneTheme";

/** On the "couldn't load" screen: a way into the downloads when the server can't be reached. */
export function OfflineDownloadsButton({ t, onPress }: { t: Translate; onPress: () => void }) {
  const view = usePhoneDownloads();
  const count = viewDownloads(view).filter((item) => item.state === "done").length;
  return count ? <TvButton deferPress label={t("watchDownloads").replace("{count}", String(count))} variant="ghost" onPress={onPress} /> : null;
}

/** The downloads of the last profile signed in here, while the server can't be reached. */
export function PhoneOfflineScreen({ api, t, language, onOpen, onRetry }: {
  api: YtZeroApi; t: Translate; language: Language; onOpen: (video: Video) => void; onRetry: () => void;
}) {
  return <View style={styles.screen}>
    <View style={styles.topBar}><Text numberOfLines={1} style={styles.title}>{t("downloadsOnPhone")}</Text></View>
    <PhoneDownloadsScreen api={api} t={t} language={language} onOpen={onOpen} header={<View style={styles.notice}>
      <Text style={styles.noticeTitle}>{t("offlineTitle")}</Text>
      <Text style={styles.noticeText}>{t("offlineHint")}</Text>
      <View style={styles.retry}><PhoneChip label={t("tryAgain")} onPress={onRetry} /></View>
    </View>} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: phoneColors.background },
  topBar: { height: phoneMetrics.topBar, justifyContent: "center", paddingHorizontal: phoneMetrics.gutter },
  title: { ...phoneType.heading, color: phoneColors.text },
  notice: { margin: 16, padding: 16, gap: 6, borderRadius: 12, backgroundColor: phoneColors.surface },
  noticeTitle: { ...phoneType.title, color: phoneColors.text },
  noticeText: { ...phoneType.body, color: phoneColors.textMuted },
  retry: { flexDirection: "row", paddingTop: 8 },
});
