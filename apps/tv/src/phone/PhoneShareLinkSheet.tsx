import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { YtZeroApi } from "../api";
import { TvChoiceSheet } from "../components/TvChoiceSheet";
import { localeTags, type Translate } from "../i18n";
import {
  shareExpiryLabel, shareExpiryOptions, shareInactiveReason, sharePlayLimitLabel, sharePlayLimitOptions, sharePlaysLabel,
  type PublicShare, type PublicShareUpdate,
} from "../publicShareOptions";
import type { Language } from "../types";
import { PhoneChip } from "./PhoneChip";
import { PhoneListRow } from "./PhoneList";
import { phoneColors, phoneType } from "./phoneTheme";

/**
 * A video's YT Zero link before it goes to Android's share sheet: whether
 * visitors stream through the server or YouTube's embed, and the link's play
 * and time limits. Each change is saved to the server as it is made.
 */
export function PhoneShareLinkSheet({ api, share: initial, title, t, language, onChange, onShare, onClose }: {
  api: YtZeroApi; share: PublicShare; title: string; t: Translate; language: Language;
  onChange: (share: PublicShare) => void; onShare: (url: string) => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [share, setShare] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [picking, setPicking] = useState<"plays" | "expiry" | null>(null);

  const update = async (patch: PublicShareUpdate) => {
    setPicking(null);
    if (busy) return;
    setBusy(true); setFailed(false);
    try { const updated = await api.updatePublicShare(share.id, patch); setShare(updated); onChange(updated); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  };
  const inactive = shareInactiveReason(share, t);
  const value = (text: string) => <Text style={styles.value}>{text}</Text>;

  return <Modal transparent visible animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <Pressable accessibilityRole="button" accessibilityLabel={t("close")} style={styles.scrim} onPress={onClose} />
    <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.handle} />
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>{t("shareLinkSettings")}</Text>
        <Text numberOfLines={1} style={styles.muted}>{title}</Text>
      </View>
      <ScrollView style={styles.list}>
        <PhoneListRow title={t("shareServerStream")} detail={t("shareServerStreamHint")} trailing={<Switch value={share.allow_server_stream}
          disabled={busy} onValueChange={(allowed) => void update({ allow_server_stream: allowed })}
          trackColor={{ true: phoneColors.accent, false: phoneColors.surfaceRaised }} thumbColor={phoneColors.text} />} />
        {share.allow_server_stream ? <Text style={styles.warning}>{t("shareServerStreamWarning")}</Text> : null}
        <PhoneListRow title={t("sharePlayLimit")} detail={`${sharePlaysLabel(share, t)}. ${t("sharePlayLimitHint")}`}
          trailing={value(sharePlayLimitLabel(share.max_plays, t))} onPress={busy ? undefined : () => setPicking("plays")} />
        {share.play_count > 0 ? <PhoneListRow title={t("shareResetPlays")} onPress={busy ? undefined : () => void update({ reset_plays: true })} /> : null}
        <PhoneListRow title={t("shareExpiry")} detail={t("shareExpiryHint")}
          trailing={value(shareExpiryLabel(share, t, localeTags[language]))} onPress={busy ? undefined : () => setPicking("expiry")} />
      </ScrollView>
      {failed || inactive ? <Text accessibilityRole="alert" style={styles.problem}>{failed ? t("shareUpdateFailed") : inactive}</Text> : null}
      <View style={styles.actions}>
        {busy ? <ActivityIndicator color={phoneColors.textMuted} /> : null}
        <PhoneChip label={t("cancel")} onPress={onClose} />
        <PhoneChip primary label={t("shareSendLink")} disabled={busy || Boolean(inactive)} onPress={() => onShare(share.url)} />
      </View>
    </View>
    {picking === "plays" ? <TvChoiceSheet title={t("sharePlayLimit")} t={t}
      value={share.max_plays == null ? "none" : String(share.max_plays)} options={sharePlayLimitOptions(share.max_plays, t)}
      onSelect={(choice) => void update({ max_plays: choice === "none" ? null : Number(choice) })} onClose={() => setPicking(null)} /> : null}
    {picking === "expiry" ? <TvChoiceSheet title={t("shareExpiry")} t={t} value="" options={shareExpiryOptions(t)}
      onSelect={(choice) => void update({ expires_in_hours: choice === "none" ? null : Number(choice) })} onClose={() => setPicking(null)} /> : null}
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { maxHeight: "85%", backgroundColor: phoneColors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8 },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: phoneColors.surfaceRaised, marginBottom: 8 },
  header: { gap: 2, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: phoneColors.divider },
  title: { ...phoneType.title, color: phoneColors.text },
  muted: { ...phoneType.caption, color: phoneColors.textMuted },
  list: { flexGrow: 0 },
  value: { ...phoneType.body, color: phoneColors.textMuted },
  warning: { ...phoneType.caption, color: phoneColors.danger, paddingHorizontal: 16, paddingBottom: 10 },
  problem: { ...phoneType.caption, color: phoneColors.danger, paddingHorizontal: 16, paddingTop: 10 },
  actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8, padding: 16 },
});
