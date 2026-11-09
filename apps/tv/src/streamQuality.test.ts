import { describe, expect, test } from "bun:test";
import { heightLabel, loadStreamQuality, parseStreamQuality, qualityButtonLabel, saveStreamQuality, STREAM_QUALITY_KEY, streamQuality } from "./streamQuality";

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { values.set(key, value); },
  };
}

describe("stream quality", () => {
  test("defaults to auto and ignores unknown values", () => {
    expect(parseStreamQuality(null)).toBe("auto");
    expect(parseStreamQuality("4320")).toBe("auto");
    expect(parseStreamQuality("720")).toBe("720");
  });

  test("is remembered on the device", async () => {
    const store = memoryStore({ [STREAM_QUALITY_KEY]: "480" });
    expect(await loadStreamQuality(store)).toBe("480");
    expect(streamQuality()).toBe("480");
    await saveStreamQuality(store, "1080");
    expect(store.values.get(STREAM_QUALITY_KEY)).toBe("1080");
    expect(streamQuality()).toBe("1080");
    expect(await loadStreamQuality(memoryStore())).toBe("auto");
  });

  test("labels the playing height, else the choice", () => {
    expect(heightLabel(719.6)).toBe("720p");
    expect(heightLabel(0)).toBeNull();
    expect(qualityButtonLabel("auto", 480, "Auto")).toBe("480p");
    expect(qualityButtonLabel("auto", null, "Auto")).toBe("Auto");
    expect(qualityButtonLabel("720", undefined, "Auto")).toBe("720p");
  });
});
