import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ApiError, type YtZeroApi } from "../api";
import type { Translate } from "../i18n";
import { phoneColors, phoneType } from "./phoneTheme";

/**
 * Signs a phone in with the profile's username and password instead of
 * approving a code in a browser. The password is sent once and never kept.
 */
export function PhonePasswordSignIn({ api, t, onAuthorized }: { api: YtZeroApi; t: Translate; onAuthorized: (accessToken: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"invalidCredentials" | "tooManyAttempts" | "passwordSignInUnavailable" | "cannotConnect" | null>(null);
  const passwordField = useRef<TextInput>(null);

  const submit = async () => {
    if (busy || !username.trim() || !password) return;
    setBusy(true); setError(null);
    try {
      const token = await api.passwordSignIn(username.trim(), password);
      setPassword("");
      await onAuthorized(token);
    } catch (cause) {
      setPassword("");
      const status = cause instanceof ApiError ? cause.status : 0;
      setError(status === 401 ? "invalidCredentials" : status === 429 ? "tooManyAttempts" : status === 400 ? "passwordSignInUnavailable" : "cannotConnect");
    } finally { setBusy(false); }
  };

  if (!open) return <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}>
    <Text style={styles.toggleText}>{t("passwordSignIn")}</Text>
  </Pressable>;
  return <View style={styles.form}>
    <Text style={styles.heading}>{t("passwordSignIn")}</Text>
    <TextInput value={username} onChangeText={setUsername} placeholder={t("username")} placeholderTextColor={phoneColors.textMuted}
      autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" importantForAutofill="yes"
      returnKeyType="next" onSubmitEditing={() => passwordField.current?.focus()} editable={!busy} accessibilityLabel={t("username")} style={styles.input} />
    <TextInput ref={passwordField} value={password} onChangeText={setPassword} placeholder={t("password")} placeholderTextColor={phoneColors.textMuted}
      secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="password" textContentType="password" importantForAutofill="yes"
      returnKeyType="go" onSubmitEditing={() => void submit()} editable={!busy} accessibilityLabel={t("password")} style={styles.input} />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !username.trim() || !password, busy }} disabled={busy || !username.trim() || !password}
      onPress={() => void submit()} style={({ pressed }) => [styles.submit, (pressed || busy || !username.trim() || !password) && styles.dimmed]}>
      {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.submitText}>{t("signIn")}</Text>}
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  toggle: { alignSelf: "stretch", alignItems: "center", paddingVertical: 12, marginTop: 10 },
  pressed: { opacity: 0.6 },
  toggleText: { ...phoneType.body, fontWeight: "600", color: phoneColors.accent },
  form: { alignSelf: "stretch", gap: 10, marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: phoneColors.surface },
  heading: { ...phoneType.title, color: phoneColors.text },
  input: { height: 46, borderRadius: 10, paddingHorizontal: 14, backgroundColor: phoneColors.surfaceRaised, color: phoneColors.text, fontSize: 16 },
  error: { ...phoneType.body, color: phoneColors.danger },
  submit: { height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: phoneColors.text },
  dimmed: { opacity: 0.5 },
  submitText: { ...phoneType.body, fontWeight: "700", color: "#000" },
});
