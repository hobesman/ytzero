import { describe, expect, test } from "bun:test";
import { createRoomVideoPicks, typedWordsKept } from "./alexaRoomVideoPicks";

describe("room video picks", () => {
  test("compares what was typed with what Alexa heard, ignoring case, accents and apostrophes", () => {
    expect(typedWordsKept("pokémon emerald but im team sky from mandjtv plays", "Pokemon emerald but IM team sky from mandjtv plays")).toBe(1);
    expect(typedWordsKept("rick astley never gonna give you up from rick astley", "rick Astley never gonna give you up")).toBeCloseTo(0.875);
    expect(typedWordsKept("leaky faucet from this old house", "the latest from veritasium")).toBeLessThan(0.3);
    expect(typedWordsKept("", "anything")).toBe(0);
  });

  test("gives the room's Echo the noted video once, within a minute and a half, for the words typed", () => {
    let clock = 0;
    const picks = createRoomVideoPicks(() => clock);
    picks.note(1, "Kitchen", "abcdefghijk", "leaky faucet from this old house");
    expect(picks.take(1, "Kitchen", "the latest from veritasium")).toBeNull();
    expect(picks.take(2, "Kitchen", "leaky faucet from this old house")).toBeNull();
    expect(picks.take(1, "Bedroom", "leaky faucet from this old house")).toBeNull();
    expect(picks.take(1, "kitchen", "Leaky faucet from this old house")).toBe("abcdefghijk");
    expect(picks.take(1, "kitchen", "Leaky faucet from this old house")).toBeNull();
    picks.note(1, "Kitchen", "abcdefghijk", "leaky faucet from this old house");
    clock += 91_000;
    expect(picks.take(1, "Kitchen", "leaky faucet from this old house")).toBeNull();
  });

  test("a channel noted for its latest video goes only to a request for the latest", () => {
    const picks = createRoomVideoPicks(() => 0);
    picks.note(1, "Kitchen", "UC_teded", "ted ed", "latest");
    expect(picks.take(1, "Kitchen", "ted ed")).toBeNull();
    expect(picks.take(1, "Kitchen", "ted ed", "shuffle")).toBeNull();
    expect(picks.take(1, "Kitchen", "ted ed", "latest")).toBe("UC_teded");
    expect(picks.take(1, "Kitchen", "leaky faucet from this old house")).toBeNull();
  });
});
