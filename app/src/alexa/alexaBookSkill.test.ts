import { describe, expect, test } from "bun:test";
import type { Book, BookProgress } from "../audiobookshelf/audiobookshelfClient";
import { BOOK_PROGRESS_REPORT_MS, createAlexaBookSkill, decodeBookToken, encodeBookToken, type BookApi, type QueuedBook } from "./alexaBookSkill";
import type { AlexaEnvelope } from "./alexaSkill";
import { MULTI_FILE_BOOK, SINGLE_FILE_BOOK } from "./alexaBookTestBooks";

type Saved = { bookId: string; update: unknown };

/** Audiobookshelf, mocked: two books, saved progress, and every save recorded. */
function fakeApi(progress: Record<string, Partial<BookProgress>> = {}, inProgress: string[] = []) {
  const books: Record<string, Book> = { [SINGLE_FILE_BOOK.id]: SINGLE_FILE_BOOK, [MULTI_FILE_BOOK.id]: MULTI_FILE_BOOK };
  const saved: Saved[] = [];
  const full = (id: string): BookProgress | null => progress[id] ? { currentTime: 0, duration: 0, progress: 0, isFinished: false, lastUpdate: 1, ...progress[id] } : null;
  const api: BookApi = {
    book: async (id) => books[id] ?? null,
    progress: async (id) => full(id),
    saveProgress: async (bookId, update) => { saved.push({ bookId, update }); },
    inProgress: async () => inProgress.map((id) => ({ id, libraryId: "lib1", title: books[id]!.title, author: "", seriesName: null, duration: books[id]!.duration, numChapters: 0, lastUpdate: 1 })),
    bookLibraries: async () => [{ id: "lib1", name: "Books" }],
    search: async (_library, query) => ({
      books: Object.values(books).filter((book) => book.title.toLowerCase().includes(query.toLowerCase()))
        .map((book) => ({ id: book.id, libraryId: "lib1", title: book.title, author: book.author, seriesName: null, duration: book.duration, numChapters: 0 })),
      authors: [], series: [],
    }),
    libraryBooks: async () => ({ books: [], total: 0 }),
    allProgress: async () => new Map(),
  };
  return { api, saved };
}

function skillWith(api: BookApi, options: { clock?: { now: number }; roomBook?: QueuedBook | null; room?: string | null } = {}) {
  const clock = options.clock ?? { now: 1_000_000 };
  const skill = createAlexaBookSkill({
    books: () => api,
    audioLink: (bookId, fileIndex, userId, start) => `https://yt.example.com/alexa/book-audio/${bookId}/${fileIndex}?u=${userId}${start ? `&t=${start}` : ""}`,
    coverLink: (bookId) => `https://yt.example.com/alexa/book-cover/${bookId}?s=x`,
    roomBook: async () => ({ room: options.room === undefined ? "Kitchen" : options.room, book: options.roomBook ?? null }),
    now: () => clock.now,
  });
  // Responses are read loosely here: each test checks the fields it cares about.
  return { ...skill, handle: (userId: number, envelope: AlexaEnvelope) => skill.handle(userId, envelope) as Promise<{ response: Record<string, any> }> };
}

const intent = (name: string, slots: Record<string, string> = {}, player?: { token: string; offsetInMilliseconds: number }): AlexaEnvelope => ({
  context: { System: { device: { deviceId: "echo-1" } }, ...(player ? { AudioPlayer: player } : {}) },
  request: { type: "IntentRequest", intent: { name, slots: Object.fromEntries(Object.entries(slots).map(([key, value]) => [key, { value }])) } },
});
const event = (type: string, token: string, offsetInMilliseconds: number): AlexaEnvelope => ({
  context: { System: { device: { deviceId: "echo-1" } } },
  request: { type, token, offsetInMilliseconds },
});
const playOf = (response: { response: Record<string, any> }) => response.response.directives?.find((directive: any) => directive.type === "AudioPlayer.Play");

describe("tokens", () => {
  test("carry only the book and the file", () => {
    expect(encodeBookToken("li_multi", 2)).toBe("hb1.li_multi.2");
    expect(decodeBookToken("hb1.li_multi.2")).toEqual({ bookId: "li_multi", fileIndex: 2 });
    expect(decodeBookToken("yv1.abcdefghijk")).toBeNull();
    expect(decodeBookToken("hb1.bad id.2")).toBeNull();
  });
});

describe("resuming", () => {
  test("resume my book starts a long single file at the saved place, with the stream starting there too", async () => {
    const { api, saved } = fakeApi({ li_single: { currentTime: 18_123.7 } }, ["li_single"]);
    const response = await skillWith(api).handle(1, intent("ResumeBookIntent"));
    const play = playOf(response);
    expect(response.response.outputSpeech.text).toBe("Resuming The Long Way by Ann Author.");
    expect(play.playBehavior).toBe("REPLACE_ALL");
    expect(play.audioItem.stream.token).toBe("hb1.li_single.0");
    // The Echo ignores the offset for the stream's own start, so the stream starts at the place and the offset says so.
    expect(play.audioItem.stream.url).toBe("https://yt.example.com/alexa/book-audio/li_single/0?u=1&t=18123");
    expect(play.audioItem.stream.offsetInMilliseconds).toBe(18_123_000);
    expect(play.audioItem.stream.progressReport).toEqual({ progressReportIntervalInMilliseconds: BOOK_PROGRESS_REPORT_MS });
    expect(play.audioItem.metadata.subtitle).toBe("Ann Author · chapter 2");
    expect(saved).toEqual([{ bookId: "li_single", update: { currentTime: 18_123, duration: 36_000 } }]);
  });

  test("a book in many files resumes in the right file", async () => {
    const { api } = fakeApi({ li_multi: { currentTime: 7_250 } }, ["li_multi"]);
    const play = playOf(await skillWith(api).handle(1, intent("ResumeBookIntent")));
    expect(play.audioItem.stream.token).toBe("hb1.li_multi.2");
    expect(play.audioItem.stream.offsetInMilliseconds).toBe(1_250_000);
  });

  test("a finished book starts over, and is marked unfinished first", async () => {
    const { api, saved } = fakeApi({ li_single: { currentTime: 36_000, isFinished: true } });
    const play = playOf(await skillWith(api).handle(1, intent("PlayBookIntent", { query: "the long way" })));
    expect(play.audioItem.stream.offsetInMilliseconds).toBe(0);
    expect(saved[0]).toEqual({ bookId: "li_single", update: { isFinished: false } });
  });

  test("resume picks up the place saved anywhere, such as the phone app, over the Echo's", async () => {
    const { api } = fakeApi({ li_single: { currentTime: 20_000 } });
    const play = playOf(await skillWith(api).handle(1, intent("AMAZON.ResumeIntent", {}, { token: "hb1.li_single.0", offsetInMilliseconds: 10_000_000 })));
    expect(play.audioItem.stream.offsetInMilliseconds).toBe(20_000_000);
  });

  test("with nothing in progress, says so", async () => {
    const { api } = fakeApi();
    const response = await skillWith(api).handle(1, intent("ResumeBookIntent"));
    expect(response.response.outputSpeech.text).toContain("don't have a book in progress");
  });
});

describe("playing on", () => {
  test("the next file is queued as one nears its end, and the place carries across files", async () => {
    const { api, saved } = fakeApi();
    const skill = skillWith(api);
    const queued = playOf(await skill.handle(1, event("AudioPlayer.PlaybackNearlyFinished", "hb1.li_multi.0", 2_990_000)));
    expect(queued.playBehavior).toBe("ENQUEUE");
    expect(queued.audioItem.stream.token).toBe("hb1.li_multi.1");
    expect(queued.audioItem.stream.expectedPreviousToken).toBe("hb1.li_multi.0");
    expect(queued.audioItem.stream.offsetInMilliseconds).toBe(0);
    await skill.handle(1, event("AudioPlayer.ProgressReportIntervalElapsed", "hb1.li_multi.1", 60_000));
    expect(saved.at(-1)).toEqual({ bookId: "li_multi", update: { currentTime: 3_060, duration: 9_000 } });
    expect(playOf(await skill.handle(1, event("AudioPlayer.PlaybackNearlyFinished", "hb1.li_multi.2", 2_990_000)))).toBeUndefined();
  });

  test("saves on every progress report and on pause", async () => {
    const { api, saved } = fakeApi();
    const skill = skillWith(api);
    await skill.handle(1, event("AudioPlayer.ProgressReportIntervalElapsed", "hb1.li_single.0", 18_060_000));
    await skill.handle(1, event("AudioPlayer.PlaybackStopped", "hb1.li_single.0", 18_075_500));
    expect(saved).toEqual([
      { bookId: "li_single", update: { currentTime: 18_060, duration: 36_000 } },
      { bookId: "li_single", update: { currentTime: 18_075.5, duration: 36_000 } },
    ]);
  });

  test("the old stream stopping right after a skip doesn't undo the skip", async () => {
    const clock = { now: 1_000_000 };
    const { api, saved } = fakeApi();
    const skill = skillWith(api, { clock });
    await skill.handle(1, intent("SkipBackIntent", {}, { token: "hb1.li_single.0", offsetInMilliseconds: 18_100_000 }));
    clock.now += 1_000;
    await skill.handle(1, event("AudioPlayer.PlaybackStopped", "hb1.li_single.0", 18_101_000));
    expect(saved).toEqual([{ bookId: "li_single", update: { currentTime: 18_070, duration: 36_000 } }]);
    clock.now += 60_000;
    await skill.handle(1, event("AudioPlayer.PlaybackStopped", "hb1.li_single.0", 18_200_000));
    expect(saved.at(-1)).toEqual({ bookId: "li_single", update: { currentTime: 18_200, duration: 36_000 } });
  });

  test("a failure saves where it got to", async () => {
    const { api, saved } = fakeApi();
    await skillWith(api).handle(1, {
      context: { System: { device: { deviceId: "echo-1" } } },
      request: { type: "AudioPlayer.PlaybackFailed", token: "hb1.li_multi.1", currentPlaybackState: { offsetInMilliseconds: 100_000 }, error: { type: "MEDIA_ERROR_UNKNOWN" } },
    });
    expect(saved).toEqual([{ bookId: "li_multi", update: { currentTime: 3_100, duration: 9_000 } }]);
  });

  test("finishing the last file marks the book finished; finishing an earlier one saves its end", async () => {
    const { api, saved } = fakeApi();
    const skill = skillWith(api);
    await skill.handle(1, event("AudioPlayer.PlaybackFinished", "hb1.li_multi.0", 3_000_000));
    await skill.handle(1, event("AudioPlayer.PlaybackFinished", "hb1.li_multi.2", 3_000_000));
    expect(saved).toEqual([
      { bookId: "li_multi", update: { currentTime: 3_000, duration: 9_000 } },
      { bookId: "li_multi", update: { isFinished: true } },
    ]);
  });
});

describe("chapters and skipping", () => {
  test("next chapter jumps to a chapter that starts in another file", async () => {
    const { api } = fakeApi();
    const play = playOf(await skillWith(api).handle(1, intent("AMAZON.NextIntent", {}, { token: "hb1.li_multi.0", offsetInMilliseconds: 2_500_000 })));
    expect(play.audioItem.stream.token).toBe("hb1.li_multi.1");
    expect(play.audioItem.stream.offsetInMilliseconds).toBe(1_500_000);
  });

  test("next chapter in the last chapter says so", async () => {
    const { api } = fakeApi();
    const response = await skillWith(api).handle(1, intent("AMAZON.NextIntent", {}, { token: "hb1.li_multi.2", offsetInMilliseconds: 100_000 }));
    expect(response.response.outputSpeech.text).toBe("This is the last chapter.");
  });

  test("previous chapter from the controller buttons", async () => {
    const { api } = fakeApi();
    const play = playOf(await skillWith(api).handle(1, {
      context: { System: { device: { deviceId: "echo-1" } }, AudioPlayer: { token: "hb1.li_single.0", offsetInMilliseconds: 20_000_000 } },
      request: { type: "PlaybackController.PreviousCommandIssued" },
    }));
    expect(play.audioItem.stream.offsetInMilliseconds).toBe(1_800_000);
  });

  test("skip back thirty seconds, and back over the start of a file", async () => {
    const { api } = fakeApi();
    const skill = skillWith(api);
    const back = playOf(await skill.handle(1, intent("SkipBackIntent", {}, { token: "hb1.li_single.0", offsetInMilliseconds: 18_100_000 })));
    expect(back.audioItem.stream.offsetInMilliseconds).toBe(18_070_000);
    const across = playOf(await skill.handle(1, intent("SkipBackIntent", { duration: "PT1M" }, { token: "hb1.li_multi.1", offsetInMilliseconds: 10_000 })));
    expect(across.audioItem.stream.token).toBe("hb1.li_multi.0");
    expect(across.audioItem.stream.offsetInMilliseconds).toBe(2_950_000);
    const forward = playOf(await skill.handle(1, intent("SkipForwardIntent", { duration: "PT5M" }, { token: "hb1.li_single.0", offsetInMilliseconds: 0 })));
    expect(forward.audioItem.stream.offsetInMilliseconds).toBe(300_000);
  });
});

describe("questions", () => {
  test("what am I listening to", async () => {
    const { api } = fakeApi();
    const response = await skillWith(api).handle(1, intent("WhatIsPlayingIntent", {}, { token: "hb1.li_single.0", offsetInMilliseconds: 20_000_000 }));
    expect(response.response.outputSpeech.text).toBe("This is The Long Way by Ann Author, chapter 2.");
  });

  test("how much is left, in the chapter and the book", async () => {
    const { api } = fakeApi();
    const skill = skillWith(api);
    const player = { token: "hb1.li_multi.1", offsetInMilliseconds: 1_000_000 };
    expect((await skill.handle(1, intent("TimeLeftIntent", {}, player))).response.outputSpeech.text)
      .toBe("There's 8 minutes left in this chapter, and 1 hour and 23 minutes left in the book.");
    expect((await skill.handle(1, intent("TimeLeftIntent", { scope: "book" }, player))).response.outputSpeech.text)
      .toBe("There's 1 hour and 23 minutes left in the book.");
    expect((await skill.handle(1, intent("TimeLeftIntent", { scope: "this chapter" }, player))).response.outputSpeech.text)
      .toBe("There's 8 minutes left in this chapter.");
  });
});

describe("play my book", () => {
  test("plays the book the tablet queued for this Echo's room, from the chosen chapter", async () => {
    const { api } = fakeApi();
    const skill = skillWith(api, { roomBook: { bookId: "li_multi", title: "Three Parts", startSeconds: 4_500 } });
    const response = await skill.handle(1, intent("PlayRoomBookIntent"));
    expect(response.response.outputSpeech.text).toBe("Playing Three Parts, from Three.");
    expect(playOf(response).audioItem.stream.token).toBe("hb1.li_multi.1");
    expect(playOf(response).audioItem.stream.offsetInMilliseconds).toBe(1_500_000);
  });

  test("a queued book with no start resumes from its saved place", async () => {
    const { api } = fakeApi({ li_single: { currentTime: 100 } });
    const skill = skillWith(api, { roomBook: { bookId: "li_single", title: "The Long Way", startSeconds: null } });
    expect(playOf(await skill.handle(1, intent("PlayRoomBookIntent"))).audioItem.stream.offsetInMilliseconds).toBe(100_000);
  });

  test("with nothing queued, says so and resumes the latest book", async () => {
    const { api } = fakeApi({ li_single: { currentTime: 100 } }, ["li_single"]);
    const response = await skillWith(api).handle(1, intent("PlayRoomBookIntent"));
    expect(response.response.outputSpeech.text).toBe("There's no book queued for the Kitchen, so resuming The Long Way.");
  });
});

test("says when Audiobookshelf isn't configured", async () => {
  const skill = createAlexaBookSkill({ books: () => ({ disabled: "not set" }), audioLink: () => "", coverLink: () => "" });
  expect(((await skill.handle(1, intent("ResumeBookIntent"))).response.outputSpeech as { text: string }).text).toBe("Hoban Books isn't connected to Audiobookshelf yet.");
});
