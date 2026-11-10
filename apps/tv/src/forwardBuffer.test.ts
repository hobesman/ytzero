import { describe, expect, test } from "bun:test";
import {
  FORWARD_BUFFER_KEY, FORWARD_BUFFER_PRESETS, forwardBuffer, forwardBufferLabel, forwardBufferOptions, loadForwardBuffer,
  MAX_FORWARD_BUFFER, MAX_FORWARD_BUFFER_BYTES, NEIGHBOUR_BUFFER_OPTIONS, onForwardBufferChange, parseForwardBuffer, saveForwardBuffer,
} from "./forwardBuffer";
import { translator } from "./i18n";
import { LANGUAGE_CODES } from "../../../shared/uiLanguages";

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { values.set(key, value); },
  };
}

describe("forward buffer", () => {
  test("accepts whole seconds from 5 to 600 and falls back to the standard buffer", () => {
    expect(parseForwardBuffer(null)).toBe(5);
    expect(parseForwardBuffer("120")).toBe(120);
    expect(parseForwardBuffer("45")).toBe(45);
    expect(parseForwardBuffer("600")).toBe(600);
    for (const invalid of ["4", "601", "12.5", "-30", "1e2", "", "abc"]) expect(parseForwardBuffer(invalid)).toBe(5);
  });

  test("is remembered on the device and announced to a playing video", async () => {
    const store = memoryStore({ [FORWARD_BUFFER_KEY]: "90" });
    expect(await loadForwardBuffer(store)).toBe(90);
    expect(forwardBuffer()).toBe(90);
    let changes = 0;
    const stop = onForwardBufferChange(() => { changes++; });
    await saveForwardBuffer(store, 120);
    stop();
    await saveForwardBuffer(store, 30);
    expect(changes).toBe(1);
    expect(store.values.get(FORWARD_BUFFER_KEY)).toBe("30");
    await expect(saveForwardBuffer(store, MAX_FORWARD_BUFFER + 1)).rejects.toThrow(RangeError);
    expect(forwardBuffer()).toBe(30);
    expect(await loadForwardBuffer(memoryStore())).toBe(5);
  });

  test("neighbours and the standard setting keep the short buffer; longer ones raise the memory cap up to a limit", () => {
    expect(forwardBufferOptions(120, false)).toBe(NEIGHBOUR_BUFFER_OPTIONS);
    expect(forwardBufferOptions(5, true)).toBe(NEIGHBOUR_BUFFER_OPTIONS);
    const long = forwardBufferOptions(120, true);
    expect(long.preferredForwardBufferDuration).toBe(120);
    expect(long.maxBufferBytes).toBeGreaterThan(NEIGHBOUR_BUFFER_OPTIONS.maxBufferBytes!);
    const longest = forwardBufferOptions(MAX_FORWARD_BUFFER, true);
    expect(longest.preferredForwardBufferDuration).toBe(MAX_FORWARD_BUFFER);
    expect(longest.maxBufferBytes).toBe(MAX_FORWARD_BUFFER_BYTES);
  });

  test("every choice is translated in every language, and custom values keep their number", () => {
    for (const language of LANGUAGE_CODES) {
      const t = translator(language);
      const labels = FORWARD_BUFFER_PRESETS.map((value) => forwardBufferLabel(value, t));
      expect(labels.every((label) => label.length > 0)).toBe(true);
      expect(new Set(labels).size).toBe(FORWARD_BUFFER_PRESETS.length);
      expect(t("bufferCustomValue")).toContain("{count}");
      expect(forwardBufferLabel(90, t)).toContain("90");
      expect(forwardBufferLabel(90, t)).not.toContain("{count}");
      for (const key of ["forwardBuffer", "forwardBufferHint", "bufferCustom", "bufferCustomHint", "bufferSecondsUnit", "save"] as const) {
        expect(t(key).length).toBeGreaterThan(0);
      }
    }
  });
});
