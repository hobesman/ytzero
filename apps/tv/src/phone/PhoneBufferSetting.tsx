import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { TvChoiceSheet } from "../components/TvChoiceSheet";
import { deviceStore } from "../deviceStore";
import { FORWARD_BUFFER_PRESETS, forwardBuffer, forwardBufferLabel, isForwardBufferPreset, MAX_FORWARD_BUFFER, MIN_FORWARD_BUFFER, saveForwardBuffer } from "../forwardBuffer";
import type { Translate } from "../i18n";
import { PhoneListRow } from "./PhoneList";
import { PhoneNumberSheet } from "./PhoneNumberSheet";
import { phoneColors, phoneType } from "./phoneTheme";

const CUSTOM = "custom";

/** This device's forward buffer: a preset, or a custom number of seconds. */
export function PhoneBufferSetting({ t, onError }: { t: Translate; onError: () => void }) {
  const [buffer, setBuffer] = useState(forwardBuffer);
  const [sheet, setSheet] = useState<"choice" | "custom" | null>(null);
  const change = (value: number) => {
    setSheet(null);
    setBuffer(value);
    void saveForwardBuffer(deviceStore, value).catch(onError);
  };
  // A custom value shows in the list too, so the current choice stays marked.
  const values = isForwardBufferPreset(buffer) ? [...FORWARD_BUFFER_PRESETS] : [...FORWARD_BUFFER_PRESETS, buffer].sort((a, b) => a - b);
  const options = [...values.map((value) => ({ value: String(value), label: forwardBufferLabel(value, t) })), { value: CUSTOM, label: t("bufferCustom") }];
  return <>
    <PhoneListRow title={t("forwardBuffer")} detail={t("forwardBufferHint")} onPress={() => setSheet("choice")}
      trailing={<Text style={styles.value}>{forwardBufferLabel(buffer, t)}</Text>} />
    {sheet === "choice" ? <TvChoiceSheet title={t("forwardBuffer")} t={t} value={String(buffer)} options={options}
      onSelect={(value) => value === CUSTOM ? setSheet("custom") : change(Number(value))} onClose={() => setSheet(null)} /> : null}
    {sheet === "custom" ? <PhoneNumberSheet title={t("forwardBuffer")} hint={t("bufferCustomHint")} unit={t("bufferSecondsUnit")}
      value={buffer} min={MIN_FORWARD_BUFFER} max={MAX_FORWARD_BUFFER} t={t} onSave={change} onClose={() => setSheet(null)} /> : null}
  </>;
}

const styles = StyleSheet.create({
  value: { ...phoneType.body, color: phoneColors.textMuted },
});
