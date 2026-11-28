import { expect, test } from "bun:test";
import { Hono } from "hono";
import { registerAlexaBookApiRoutes, type BookClient } from "./alexaBookApiRoutes";

test("the library lists newest first by default, and in the order asked for", async () => {
  const asked: { sort?: string; desc?: boolean }[] = [];
  const books = {
    bookLibraries: async () => [{ id: "lib1", name: "Books" }],
    allProgress: async () => new Map(),
    libraryBooks: async (_id: string, options: { sort?: string; desc?: boolean }) => { asked.push({ sort: options.sort, desc: options.desc }); return { books: [], total: 0 }; },
  } as unknown as BookClient;
  const api = new Hono<{ Variables: { userId: number } }>();
  registerAlexaBookApiRoutes(api, {
    currentUserId: () => 1, rooms: {} as never, settings: {} as never, now: () => 0, controls: () => "off", audiobookshelf: () => books,
  });
  for (const sort of ["", "random", "title", "toString"]) {
    expect((await api.request(`/alexa/books/library${sort ? `?sort=${sort}` : ""}`)).status).toBe(200);
  }
  expect(asked).toEqual([
    { sort: "addedAt", desc: true }, { sort: "random", desc: false }, { sort: "media.metadata.title", desc: false }, { sort: "addedAt", desc: true },
  ]);
});
