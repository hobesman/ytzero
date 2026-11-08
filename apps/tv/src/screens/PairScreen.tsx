import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, View } from "react-native";
import { PhonePasswordSignIn } from "../phone/PhonePasswordSignIn";
import QRCode from "react-native-qrcode-svg";
import type { YtZeroApi } from "../api";
import type { Translate } from "../i18n";
import type { PairingAuthorization } from "../types";
import { colors, typography } from "../theme";
import { TvSetupLayout } from "../components/TvSetupLayout";
import { TvPairingConnection } from "../components/TvPairingConnection";
import { TvButton } from "../components/TvButton";
import { useCompactLayout } from "../useCompactLayout";

type Props = {
  api: YtZeroApi;
  pairing: PairingAuthorization;
  t: Translate;
  onAuthorized: (accessToken: string) => Promise<void>;
  onRetry: () => Promise<void>;
  onChangeInstance: () => void;
  onBack?: () => void;
};

export function PairScreen({ api, pairing, t, onAuthorized, onRetry, onChangeInstance, onBack }: Props) {
  const [expired, setExpired] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const authorized = useRef(onAuthorized);
  authorized.current = onAuthorized;
  const displayCode = pairing.userCode.split("-").join("  ");
  const compact = useCompactLayout();

  useEffect(() => {
    setExpired(false);
    setNetworkError(false);
    let cancelled = false;
    let acceptedToken: string | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expiresAt = Date.now() + pairing.expiresIn * 1000;
    const poll = async () => {
      if (cancelled) return;
      if (!acceptedToken && Date.now() >= expiresAt) {
        setExpired(true);
        return;
      }
      try {
        const result = acceptedToken ? { kind: "authorized" as const, accessToken: acceptedToken } : await api.pollPairing(pairing.deviceCode);
        if (cancelled) return;
        setNetworkError(false);
        if (result.kind === "authorized") {
          // Device codes are single-use. If restoring the selected profile
          // temporarily fails, retry with the accepted token held only in memory.
          acceptedToken = result.accessToken;
          await authorized.current(result.accessToken);
          return;
        }
        if (result.kind === "expired") return setExpired(true);
      } catch {
        if (!cancelled) setNetworkError(true);
      }
      timeout = setTimeout(poll, Math.max(2, pairing.interval) * 1000);
    };
    timeout = setTimeout(poll, pairing.interval * 1000);
    return () => { cancelled = true; if (timeout) clearTimeout(timeout); };
  }, [api, pairing]);

  return <TvSetupLayout title={t("pairTitle")} description={compact ? t("pairPhoneDescription") : t("pairDescription")} t={t} onBack={onBack} copyHeader={<TvPairingConnection />}
    copyFooter={<>
      <View style={[styles.codePanel, compact && compactStyles.codePanel]}><Text style={styles.codeLabel}>{t("enterCode")}</Text><Text style={[styles.code, compact && compactStyles.code]} numberOfLines={1} adjustsFontSizeToFit>{displayCode}</Text></View>
      {compact && !expired ? <TvButton label={t("openSignInPage")} variant="primary" onPress={() => void Linking.openURL(pairing.verificationUriComplete)} style={compactStyles.openButton} /> : null}
      {compact && !Platform.isTV ? <PhonePasswordSignIn api={api} t={t} onAuthorized={onAuthorized} /> : null}
      {!expired ? <View style={styles.waiting}><View style={styles.spinner}><ActivityIndicator color={networkError ? colors.danger : colors.textMuted} size="small" style={styles.spinnerScale} /></View><Text style={[styles.waitingText, networkError && styles.error, compact && compactStyles.small]}>{networkError ? t("cannotConnect") : t("waiting")}</Text></View>
        : <View style={[styles.expired, compact && compactStyles.expired]}><Text style={[styles.error, compact && compactStyles.small]}>{networkError ? t("cannotConnect") : t("pairExpired")}</Text><TvButton label={t("retry")} variant="primary" onPress={() => void onRetry().catch(() => setNetworkError(true))} /></View>}
      <TvButton deferPress label={t("changeInstance")} preferredFocus variant="ghost" onPress={onChangeInstance} style={styles.changeButton} />
    </>}>
    <View style={[styles.qrPanel, compact && compactStyles.qrPanel]}><View style={[styles.qr, compact && compactStyles.qr]}><QRCode value={pairing.verificationUriComplete} size={compact ? 150 : 286} backgroundColor={colors.white} color={colors.black} /></View><Text style={[styles.uri, compact && compactStyles.uri]} selectable>{pairing.verificationUriComplete}</Text></View>
  </TvSetupLayout>;
}

const styles = StyleSheet.create({
  codePanel: { alignSelf: "flex-start", minWidth: 560, backgroundColor: colors.surface, borderRadius: 26, paddingHorizontal: 30, paddingVertical: 23, marginTop: 34 },
  codeLabel: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.7, textAlign: "center" },
  code: { color: colors.text, fontSize: 52, lineHeight: 64, fontWeight: "800", letterSpacing: 6, marginTop: 2, textAlign: "center" },
  waiting: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 20, paddingHorizontal: 4, minHeight: 40, marginTop: 20 },
  spinner: { width: 24, height: 24, alignItems: "center", justifyContent: "center", marginRight: 4 },
  spinnerScale: { transform: [{ scale: .65 }] },
  waitingText: { color: colors.textMuted, fontSize: typography.caption.fontSize },
  expired: { flexDirection: "row", alignItems: "center", gap: 22, marginTop: 20 },
  error: { color: colors.danger, fontSize: typography.caption.fontSize, fontWeight: "700" },
  changeButton: { alignSelf: "flex-start", marginTop: 14 },
  qrPanel: { alignItems: "center", paddingVertical: 36 },
  qr: { backgroundColor: colors.white, borderRadius: 27, padding: 25, overflow: "hidden" },
  uri: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "600", marginTop: 20, textAlign: "center", maxWidth: 420 },
});

const compactStyles = StyleSheet.create({
  codePanel: { alignSelf: "stretch", minWidth: 0, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12, marginTop: 18 },
  code: { fontSize: 32, lineHeight: 40, letterSpacing: 3 },
  openButton: { alignSelf: "stretch", marginTop: 16 },
  small: { fontSize: 15 },
  expired: { flexWrap: "wrap", gap: 12 },
  qrPanel: { paddingVertical: 18, paddingHorizontal: 12 },
  qr: { borderRadius: 16, padding: 12 },
  uri: { fontSize: 13, lineHeight: 18, marginTop: 12, maxWidth: "100%" },
});
