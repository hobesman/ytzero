import { describe, expect, test } from "bun:test";
import type { Translate } from "../i18n";
import { musicMessages } from "./musicMessages";
import { playlistAddNotice } from "./musicPlaylistAdd";

const t = ((key: keyof typeof musicMessages.en) => musicMessages.en[key]) as unknown as Translate;
const songs = (count: number) => `${count} ${count === 1 ? "song" : "songs"}`;
const result = (added: number, present = 0, full = 0, unknown = 0) => ({ added, present, full, unknown });

describe("playlistAddNotice", () => {
  test("says how many songs were added", () => expect(playlistAddNotice(result(17), "Road trip", t, songs)).toBe("Added 17 songs to Road trip"));
  test("mentions songs that were already there", () =>
    expect(playlistAddNotice(result(10, 1), "Road trip", t, songs)).toBe("Added 10 songs to Road trip (1 song already there)"));
  test("says so when every song was already there", () => expect(playlistAddNotice(result(0, 17), "Road trip", t, songs)).toBe("Already in Road trip"));
  test("says the playlist is full when songs didn't fit", () =>
    expect(playlistAddNotice(result(3, 0, 14), "Road trip", t, songs)).toBe("Road trip is full. Added 3 songs; the rest didn't fit."));
  test("fails when nothing could be added", () => expect(playlistAddNotice(result(0, 0, 0, 5), "Road trip", t, songs)).toBe(musicMessages.en.musicActionFailed));
  test("every language keeps the placeholders", () => {
    for (const messages of Object.values(musicMessages)) {
      for (const key of ["musicAddedSongsToPlaylist", "musicAddedSongsSomeThere", "musicPlaylistFullPartly"] as const) {
        expect(messages[key]).toContain("{name}");
        expect(messages[key]).toContain("{songs}");
      }
      expect(messages.musicAddedSongsSomeThere).toContain("{already}");
    }
  });
});
