import { describe, expect, test } from "bun:test";
import { walkContinuationPages } from "./continuationPages";

type Page = { items: number[]; next: string | null };

/** Pages keyed by the token that requests them; "boom" and "refused" fail. */
function walk(pages: Record<string, Page>, firstToken: string | null, maxPages = 10) {
  const out: number[] = [];
  const requested: string[] = [];
  const run = walkContinuationPages<Page>({
    label: "channel videos",
    logFields: { channelId: "UC_test", tab: "videos" },
    firstToken,
    maxPages,
    fetchPage: async (token) => {
      requested.push(token);
      if (token === "boom") throw new Error("browse continuation fetch failed (500)");
      if (token === "refused") throw new Error("browse continuation fetch failed (429)");
      return pages[token];
    },
    collect: (page) => out.push(...page.items),
    nextToken: (page) => page.next,
    collected: () => out.length,
  });
  return { run, out, requested };
}

describe("walkContinuationPages", () => {
  test("follows pages until the history runs out", async () => {
    const w = walk({ a: { items: [1, 2], next: "b" }, b: { items: [3], next: null } }, "a");
    await w.run;
    expect(w.out).toEqual([1, 2, 3]);
    expect(w.requested).toEqual(["a", "b"]);
  });

  test("does nothing without a first token", async () => {
    const w = walk({}, null);
    await w.run;
    expect(w.requested).toEqual([]);
  });

  test("keeps what it collected when the page cap is reached", async () => {
    const w = walk({ a: { items: [1], next: "b" }, b: { items: [2], next: "c" } }, "a", 2);
    await w.run;
    expect(w.out).toEqual([1, 2]);
    expect(w.requested).toEqual(["a", "b"]);
  });

  test("keeps what it collected when a page fails", async () => {
    const w = walk({ a: { items: [1, 2], next: "boom" } }, "a");
    await w.run;
    expect(w.out).toEqual([1, 2]);
    expect(w.requested).toEqual(["a", "boom"]);
  });

  test("rethrows a rate limit so the sync backs off", async () => {
    const w = walk({ a: { items: [1], next: "refused" } }, "a");
    await expect(w.run).rejects.toThrow("429");
  });

  test("rejects a repeated continuation token", async () => {
    const w = walk({ a: { items: [1], next: "a" } }, "a");
    await expect(w.run).rejects.toThrow("channel videos continuation repeated");
  });
});
