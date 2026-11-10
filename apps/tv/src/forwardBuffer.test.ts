import { describe, expect, test } from "bun:test";
import { FORWARD_BUFFER_KEY, FORWARD_BUFFERS, forwardBuffer, forwardBufferLabelKey, forwardBufferOptions, loadForwardBuffer, NEIGHBOUR_BUFFER_OPTIONS, onForwardBufferChange, parseForwardBuffer, saveForwardBuffer } from "./forwardBuffer";
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
  test("defaults to the standard buffer and ignores unknown values", () => {
    expect(parseForwardBuffer(null)).toBe(5);
    expect(parseForwardBuffer("45")).toBe(5);
    expect(parseForwardBuffer("120")).toBe(120);
  });

  test("is remembered on the device and announced to a playing video", async () => {
    const store = memoryStore({ [FORWARD_BUFFER_KEY]: "60" });
    expect(await loadForwardBuffer(store)).toBe(60);
    expect(forwardBuffer()).toBe(60);
    let changes = 0;
    const stop = onForwardBufferChange(() => { changes++; });
    await saveForwardBuffer(store, 120);
    stop();
    await saveForwardBuffer(store, 30);
    expect(changes).toBe(1);
    expect(store.values.get(FORWARD_BUFFER_KEY)).toBe("30");
    expect(await loadForwardBuffer(memoryStore())).toBe(5);
  });

  test("neighbours and the standard setting keep the short buffer; longer ones raise the memory cap", () => {
    expect(forwardBufferOptions(120, false)).toBe(NEIGHBOUR_BUFFER_OPTIONS);
    expect(forwardBufferOptions(5, true)).toBe(NEIGHBOUR_BUFFER_OPTIONS);
    const long = forwardBufferOptions(120, true);
    expect(long.preferredForwardBufferDuration).toBe(120);
    expect(long.maxBufferBytes).toBeGreaterThan(NEIGHBOUR_BUFFER_OPTIONS.maxBufferBytes!);
    expect(long.maxBufferBytes).toBeLessThanOrEqual(96 * 1024 * 1024);
  });

  test("every choice is translated in every language", () => {
    for (const language of LANGUAGE_CODES) {
      const t = translator(language);
      const labels = FORWARD_BUFFERS.map((value) => t(forwardBufferLabelKey(value)));
      expect(labels.every((label) => label.length > 0)).toBe(true);
      expect(new Set(labels).size).toBe(FORWARD_BUFFERS.length);
      expect(t("forwardBuffer").length).toBeGreaterThan(0);
      expect(t("forwardBufferHint").length).toBeGreaterThan(0);
    }
  });
});
