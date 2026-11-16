import { describe, expect, test } from "bun:test";
import { cappedStreamQuality, loadLowResource, LOW_RESOURCE_KEY, lowResource, phoneListWindow, saveLowResource, smallThumbnailUrl } from "./lowResource";

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItemAsync: async (key: string) => values.get(key) ?? null, setItemAsync: async (key: string, value: string) => { values.set(key, value); } };
}

describe("low-resource mode", () => {
  test("is off unless stored as on", async () => {
    expect(await loadLowResource(memoryStore())).toBe(false);
    expect(await loadLowResource(memoryStore({ [LOW_RESOURCE_KEY]: "yes" }))).toBe(false);
    expect(await loadLowResource(memoryStore({ [LOW_RESOURCE_KEY]: "1" }))).toBe(true);
  });

  test("saving stores the choice and applies it", async () => {
    const store = memoryStore();
    await saveLowResource(store, true);
    expect(store.values.get(LOW_RESOURCE_KEY)).toBe("1");
    expect(lowResource()).toBe(true);
    await saveLowResource(store, false);
    expect(store.values.get(LOW_RESOURCE_KEY)).toBe("0");
    expect(lowResource()).toBe(false);
  });

  test("caps video at the 360p stream", () => {
    for (const choice of ["auto", "1080", "720", "480"] as const) expect(cappedStreamQuality(choice, true)).toBe("fast");
    expect(cappedStreamQuality("360", true)).toBe("360");
    expect(cappedStreamQuality("fast", true)).toBe("fast");
    expect(cappedStreamQuality("1080", false)).toBe("1080");
  });

  test("loads YouTube thumbnails at 320×180", () => {
    expect(smallThumbnailUrl("https://i.ytimg.com/vi/abc/hqdefault.jpg")).toBe("https://i.ytimg.com/vi/abc/mqdefault.jpg");
    expect(smallThumbnailUrl("https://i.ytimg.com/vi/abc/hq720.jpg?sqp=xyz&rs=1")).toBe("https://i.ytimg.com/vi/abc/mqdefault.jpg");
    expect(smallThumbnailUrl("https://i9.ytimg.com/vi_webp/abc/maxresdefault.webp")).toBe("https://i9.ytimg.com/vi_webp/abc/mqdefault.webp");
  });

  test("leaves other images alone", () => {
    expect(smallThumbnailUrl("https://i.ytimg.com/vi/abc/mqdefault.jpg")).toBe("https://i.ytimg.com/vi/abc/mqdefault.jpg");
    expect(smallThumbnailUrl("https://yt3.ggpht.com/avatar=s88")).toBe("https://yt3.ggpht.com/avatar=s88");
    expect(smallThumbnailUrl("/media/thumb.jpg")).toBe("/media/thumb.jpg");
  });

  test("keeps fewer list rows mounted", () => {
    expect(phoneListWindow(true).windowSize).toBeLessThan(phoneListWindow(false).windowSize);
  });
});
