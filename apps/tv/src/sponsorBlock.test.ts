import { describe, expect, test } from "bun:test";
import { normalizeSponsorSegments, segmentAt, sponsorCategories } from "./sponsorBlock";

describe("SponsorBlock", () => {
  test("reads the profile's categories only when skipping is on", () => {
    expect(sponsorCategories("0", '["sponsor"]')).toBeNull();
    expect(sponsorCategories(undefined, undefined)).toBeNull();
    expect(sponsorCategories("1", '["sponsor","intro"]')).toEqual(["sponsor", "intro"]);
    expect(sponsorCategories("1", "")).toEqual(["sponsor"]);
    expect(sponsorCategories("1", "[]")).toBeNull();
    expect(sponsorCategories("1", "not json")).toEqual(["sponsor"]);
  });

  test("keeps well-formed skip segments", () => {
    const segments = normalizeSponsorSegments("abc", [
      { category: "sponsor", actionType: "skip", segment: [10, 20], UUID: "u1" },
      { category: "poi_highlight", actionType: "poi", segment: [5, 5], UUID: "u2" },
      { category: "intro", actionType: "skip", segment: [30, 25], UUID: "u3" },
      { category: "outro", actionType: "skip", segment: ["40", "50"] },
    ]);
    expect(segments).toEqual([
      { category: "sponsor", actionType: "skip", segment: [10, 20], UUID: "u1" },
      { category: "outro", actionType: "skip", segment: [40, 50], UUID: "abc:outro:40:50:3" },
    ]);
    expect(normalizeSponsorSegments("abc", { message: "Not Found" })).toEqual([]);
  });

  test("finds the segment being played, but not its last moment", () => {
    const segments = normalizeSponsorSegments("abc", [{ category: "sponsor", actionType: "skip", segment: [10, 20], UUID: "u1" }]);
    expect(segmentAt(segments, 9.9)).toBeNull();
    expect(segmentAt(segments, 10)?.UUID).toBe("u1");
    expect(segmentAt(segments, 19.5)?.UUID).toBe("u1");
    expect(segmentAt(segments, 19.8)).toBeNull();
  });
});
