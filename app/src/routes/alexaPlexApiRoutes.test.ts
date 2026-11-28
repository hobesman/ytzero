import { expect, test } from "bun:test";
import { Hono } from "hono";
import type { PlexItem, PlexSummary } from "../plex/plexClient";
import { registerAlexaPlexApiRoutes, type PlexBrowseClient } from "./alexaPlexApiRoutes";

const summary = (fields: Partial<PlexSummary> & Pick<PlexSummary, "id" | "type" | "title">): PlexSummary => ({
  year: null, showTitle: null, thumb: `/library/metadata/${fields.id}/thumb/1`, duration: 0, viewOffset: 0, watched: false, leafCount: 0, viewedLeafCount: 0, overview: "", contentRating: "", ...fields,
});
const episode = (id: string, season: number, number: number, watched = false): PlexItem => ({
  id, type: "episode", title: `Episode ${number}`, year: null, show: { id: "200", title: "The Office" }, season, episode: number, duration: 1_300,
  viewOffset: 0, watched, partKey: "/library/parts/1/file.mkv", audio: [], chapters: [], thumb: "/library/metadata/200/thumb/1", contentRating: "", lastViewedAt: 0,
});

function setup() {
  const asked: { libraryId: string; start: number; sort: string }[] = [];
  const posters: string[] = [];
  const plex = {
    libraries: async () => [{ id: "1", type: "movie", title: "Movies" }],
    libraryItems: async (libraryId: string, options: { start: number; size: number; sort: string }) => {
      asked.push({ libraryId, start: options.start, sort: options.sort });
      return { items: [summary({ id: "101", type: "movie", title: "Heat" })], total: 1 };
    },
    search: async () => [],
    summary: async (id: string) => id === "200" ? summary({ id, type: "show", title: "The Office", leafCount: 3 }) : null,
    item: async (id: string) => id === "101" ? { ...episode("101", 0, 0), type: "movie", show: null, season: null, episode: null, duration: 6_000 } as PlexItem : null,
    episodes: async () => [episode("201", 1, 1, true), episode("202", 1, 2), episode("301", 2, 1)],
    onDeck: async () => [],
    image: async (path: string) => { posters.push(path); return new Response("jpeg", { headers: { "content-type": "image/jpeg" } }); },
  } as unknown as PlexBrowseClient;
  const api = new Hono<{ Variables: { userId: number } }>();
  registerAlexaPlexApiRoutes(api, { currentUserId: () => 1, controls: () => "Home Assistant isn't configured.", plex: () => plex });
  return { api, asked, posters };
}

test("a library lists newest first by default, a page at a time, in the order asked for", async () => {
  const { api, asked } = setup();
  for (const query of ["libraryId=1", "libraryId=1&sort=title&page=2", "libraryId=1&sort=toString"]) {
    expect((await api.request(`/alexa/plex/library?${query}`)).status).toBe(200);
  }
  expect(asked).toEqual([{ libraryId: "1", start: 0, sort: "newest" }, { libraryId: "1", start: 80, sort: "title" }, { libraryId: "1", start: 0, sort: "newest" }]);
  expect((await api.request("/alexa/plex/library")).status).toBe(400);
});

test("a show comes with its episodes by season and the one to carry on with", async () => {
  const { api } = setup();
  const body = await (await api.request("/alexa/plex/items/200")).json() as { show: { nextUpId: string; seasons: { season: number; episodes: { id: string }[] }[] } };
  expect(body.show.nextUpId).toBe("202");
  expect(body.show.seasons.map((season) => [season.season, season.episodes.map((item) => item.id)])).toEqual([[1, ["201", "202"]], [2, ["301"]]]);
  expect((await api.request("/alexa/plex/items/999")).status).toBe(404);
  expect((await api.request("/alexa/plex/items/abc")).status).toBe(404);
});

test("posters come through the server from the paths the lists gave", async () => {
  const { api, posters } = setup();
  await api.request("/alexa/plex/library?libraryId=1");
  const poster = await api.request("/alexa/plex/items/101/poster");
  expect(poster.status).toBe(200);
  expect(posters).toEqual(["/library/metadata/101/thumb/1"]);
  expect((await api.request("/alexa/plex/items/555/poster")).status).toBe(404);
});

test("playing in a room checks the title and the place before reaching the Echo", async () => {
  const { api } = setup();
  const play = (body: unknown) => api.request("/alexa/rooms/Kitchen/plex", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  expect((await play({})).status).toBe(400);
  expect((await play({ itemId: "999" })).status).toBe(404);
  expect((await play({ itemId: "101", startSeconds: 6_000 })).status).toBe(400);
  expect((await play({ itemId: "101", startSeconds: -1 })).status).toBe(400);
  const off = await play({ itemId: "101", startSeconds: 600 });
  expect(off.status).toBe(503);
  expect(await off.json()).toEqual({ error: "Home Assistant isn't configured." });
});

test("says when Plex isn't set up", async () => {
  const api = new Hono<{ Variables: { userId: number } }>();
  registerAlexaPlexApiRoutes(api, { currentUserId: () => 1, controls: () => "off", plex: () => ({ disabled: "YTZERO_PLEX_URL and YTZERO_PLEX_TOKEN are not set" }) });
  expect(await (await api.request("/alexa/plex")).json()).toEqual({ enabled: false, reason: "YTZERO_PLEX_URL and YTZERO_PLEX_TOKEN are not set", libraries: [] });
  expect((await api.request("/alexa/plex/deck")).status).toBe(503);
});

test("lists only titles up to the rating asked for, the library's own rating strings passed to Plex", async () => {
  const asked: (readonly string[] | undefined)[] = [];
  const plex = {
    libraries: async () => [],
    libraryContentRatings: async () => ["G", "PG", "PG-13", "R", "gb/PG", "Not Rated"],
    libraryItems: async (_libraryId: string, options: { contentRatings?: readonly string[] }) => { asked.push(options.contentRatings); return { items: [], total: 0 }; },
    search: async () => [summary({ id: "1", type: "movie", title: "Cars", contentRating: "G" }), summary({ id: "2", type: "movie", title: "Heat", contentRating: "R" }),
      summary({ id: "3", type: "show", title: "Bluey", contentRating: "TV-Y" }), summary({ id: "4", type: "movie", title: "Home video" })],
    onDeck: async () => [{ ...episode("201", 1, 1), contentRating: "TV-14" }, { ...episode("202", 1, 2), contentRating: "TV-PG" }],
  } as unknown as PlexBrowseClient;
  const api = new Hono<{ Variables: { userId: number } }>();
  registerAlexaPlexApiRoutes(api, { currentUserId: () => 1, controls: () => "off", plex: () => plex });
  await api.request("/alexa/plex/library?libraryId=1&rating=pg");
  await api.request("/alexa/plex/library?libraryId=1&rating=all");
  await api.request("/alexa/plex/library?libraryId=1");
  expect(asked).toEqual([["G", "PG", "gb/PG"], undefined, undefined]);
  const found = await (await api.request("/alexa/plex/library?q=a&rating=pg")).json() as { items: { id: string }[] };
  expect(found.items.map((item) => item.id)).toEqual(["1", "3"]);
  const deck = await (await api.request("/alexa/plex/deck?rating=pg")).json() as { items: { id: string }[] };
  expect(deck.items.map((item) => item.id)).toEqual(["202"]);
});
