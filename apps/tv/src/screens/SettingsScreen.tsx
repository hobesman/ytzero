import { TvSwitch } from "../components/TvSwitch";
import { TvPageHeading } from "../components/TvPageHeading";
import { useEffect, useRef, useState } from "react";
import { focusWhenReady, useContentFocusAllowed } from "../focus";
import { ScrollView, StyleSheet, Text, TVFocusGuideView, View, type FocusDestination } from "react-native";
import type { Translate } from "../i18n";
import { colors, typography, screenPadding } from "../theme";
import { TvButton } from "../components/TvButton";
import { TvSettingRow, TvSettingsSection } from "../components/TvSettingsSection";

type SystemProfilesSettings = {
  available: boolean; enabled: boolean; canRemember: boolean; canLink: boolean;
  linkedName: string | null; isCurrentLinked: boolean;
  onEnabledChange: (enabled: boolean) => Promise<void>; onLinkCurrent: () => Promise<void>;
};
type Props = { systemProfiles: SystemProfilesSettings; openDetails: boolean; onOpenDetailsChange: (value: boolean) => Promise<void>;
  /** Android phones only: the phone design preview. */ phoneDesign?: boolean; onPhoneDesignChange?: (value: boolean) => Promise<void>; focusRequest: number; instanceUrl: string; profileFocusTarget: FocusDestination; onPrimaryFocusTarget: (target: View | null) => void; onChangeInstance: () => Promise<void>; onSignOut: () => Promise<void>; t: Translate };
export function SettingsScreen({ systemProfiles, openDetails, onOpenDetailsChange, phoneDesign, onPhoneDesignChange, focusRequest, instanceUrl, profileFocusTarget, onPrimaryFocusTarget, onChangeInstance, onSignOut, t }: Props) {
  const contentFocusAllowed = useContentFocusAllowed();
  const handledFocusRequest = useRef<number | null>(null);
  const [connection, setConnection] = useState<View | null>(null);
  const [session, setSession] = useState<View | null>(null);
  const [preference, setPreference] = useState<View | null>(null);
  const [systemToggle, setSystemToggle] = useState<View | null>(null);
  const [systemLink, setSystemLink] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    onPrimaryFocusTarget(connection);
    return () => onPrimaryFocusTarget(null);
  }, [connection, onPrimaryFocusTarget]);
  useEffect(() => {
    if (!contentFocusAllowed || !connection || handledFocusRequest.current === focusRequest) return;
    return focusWhenReady(connection, () => { handledFocusRequest.current = focusRequest; });
  }, [connection, contentFocusAllowed, focusRequest]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setFailed(false);
    try { await action(); } catch { setFailed(true); } finally { setBusy(false); }
  };
  return <TVFocusGuideView autoFocus style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <TvPageHeading title={t("deviceSettingsTitle")} />
      <TvSettingsSection title={t("connection")}><TvSettingRow title={t("currentInstance")} detail={instanceUrl}>
        <TvButton ref={setConnection} deferPress label={t("changeInstance")} accessibilityState={{ busy }} nextFocusUp={profileFocusTarget} nextFocusDown={session ?? undefined} onPress={() => void run(onChangeInstance)} />
      </TvSettingRow></TvSettingsSection>
      <TvSettingsSection title={t("session")}><TvSettingRow title={t("signOut")} detail={t("signOutHint")}>
        <TvButton ref={setSession} label={t("signOut")} variant="danger" accessibilityState={{ busy }} nextFocusUp={connection ?? undefined} nextFocusDown={preference ?? undefined} onPress={() => void run(onSignOut)} />
      </TvSettingRow></TvSettingsSection>
      <TvSettingsSection title={t("devicePlayback")}><TvSwitch ref={setPreference} label={t("openDetailsFirst")} description={t("openDetailsFirstHint")} value={openDetails} busy={busy} nextFocusUp={session ?? undefined} nextFocusDown={systemToggle ?? undefined} onValueChange={(value) => void run(() => onOpenDetailsChange(value))} />
        {phoneDesign !== undefined && onPhoneDesignChange ? <View style={styles.phoneDesign}><TvSwitch label={t("phoneLayout")} description={t("phoneLayoutHint")} value={phoneDesign} busy={busy}
          onValueChange={(value) => void run(() => onPhoneDesignChange(value))} /></View> : null}</TvSettingsSection>
      {systemProfiles.available ? <TvSettingsSection title={t("appleProfilesTitle")}>
        <TvSwitch ref={setSystemToggle} label={t("appleProfilesAutomatic")} value={systemProfiles.enabled}
          description={!systemProfiles.canLink ? t("appleProfilesUpdateServer") : !systemProfiles.canRemember ? t("appleProfilesAddUsers") : t("appleProfilesAutomaticHint")}
          busy={busy} disabled={(!systemProfiles.enabled && (!systemProfiles.canRemember || !systemProfiles.canLink))}
          nextFocusUp={preference ?? undefined} nextFocusDown={systemLink ?? undefined}
          onValueChange={(value) => void run(() => systemProfiles.onEnabledChange(value))} />
        {systemProfiles.enabled ? <View style={styles.profileLink}>
          <TvSettingRow title={`${t("appleProfilesLinked")}: ${systemProfiles.linkedName ?? t("appleProfilesNotLinked")}`} detail={t("appleProfilesLinkHint")}>
            {systemProfiles.isCurrentLinked ? null : <TvButton ref={setSystemLink} label={t("appleProfilesLinkCurrent")}
              accessibilityState={{ busy }} disabled={!systemProfiles.canRemember || !systemProfiles.canLink}
              nextFocusUp={systemToggle ?? undefined} onPress={() => void run(async () => {
                await systemProfiles.onLinkCurrent();
                requestAnimationFrame(() => systemToggle?.requestTVFocus());
              })} />}
          </TvSettingRow>
        </View> : null}
      </TvSettingsSection> : null}
      {failed ? <Text style={styles.error}>{t("cannotConnect")}</Text> : null}
    </ScrollView>
  </TVFocusGuideView>;
}
const styles = StyleSheet.create({
  profileLink: { marginTop: 16 },
  phoneDesign: { marginTop: 16 },
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: screenPadding + 20, paddingTop: 150, paddingBottom: 90 },
  description: { color: colors.textMuted, fontSize: 23, lineHeight: 33, maxWidth: 1000, marginBottom: 48 },
  error: { color: colors.danger, fontSize: typography.caption.fontSize, marginBottom: 20 },
});
