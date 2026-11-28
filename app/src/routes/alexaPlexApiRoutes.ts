import type { Context, Hono } from "hono";
import { movieResumePosition, nextUp } from "../alexa/alexaMovieSkill";
import { RoomControlError, type RoomControlDependencies } from "../alexa/alexaRoomControl";
import { playRoomPlex } from "../alexa/alexaRoomPlex";
import type { RoomPlexPicks } from "../alexa/alexaRoomPlexPicks";
import { normalizeRoomName } from "../alexa/alexaRooms";
import { HomeAssistantError } from "../alexa/homeAssistant";
import {
  defaultPlex, isPlexId, PLEX_LIBRARY_SORTS, PlexError, type PlexClient, type PlexItem, type PlexLibrarySort, type PlexSummary,
} from "../plex/plexClient";

type ApiEnvironment = { Variables: { userId: number } };
type ApiContext = Context<ApiEnvironment>;

export type PlexBrowseClient = Pick<PlexClient, "libraries" | "libraryItems" | "search" | "summary" | "item" | "episodes" | "onDeck" | "image">;

export interface AlexaPlexApiDependencies {
  currentUserId: (context: ApiContext) => number;
  /** Room controls, or why there are none (Home Assistant not configured). */
  controls: () => RoomControlDependencies | string;
  plex?: () => PlexBrowseClient | { disabled: string };
  picks?: RoomPlexPicks;
}

const PAGE_SIZE = 40;
const POSTER_CACHE_LIMIT = 2_000;

const publicSummary = (item: PlexSummary) => ({
  id: item.id, type: item.type, title: item.title, year: item.year, showTitle: item.showTitle, duration: item.duration,
  viewOffset: item.viewOffset, watched: item.watched, leafCount: item.leafCount, viewedLeafCount: item.viewedLeafCount,
});

const publicItem = (item: PlexItem) => ({
  id: item.id, type: item.type, title: item.title, year: item.year, show: item.show, season: item.season, episode: item.episode,
  duration: item.duration, viewOffset: item.viewOffset, watched: item.watched, resumeAt: movieResumePosition(item),
  chapters: item.chapters.map((chapter, index) => ({ index, ...chapter })),
});

/**
 * The room tablet's Plex tab: what Plex has on deck, the movie and TV
 * libraries with search, a movie's chapters or a show's episodes, posters,
 * and starting a title on a room's Echo. The Plex token stays here.
 */
export function registerAlexaPlexApiRoutes(api: Hono<ApiEnvironment>, dependencies: AlexaPlexApiDependencies): void {
  const plex = dependencies.plex ?? defaultPlex;
  // Posters are asked for by item; their Plex paths come with the lists, so most need no extra call.
  const thumbs = new Map<string, string>();
  const remember = (items: readonly { id: string; thumb: string }[]) => {
    for (const item of items) if (item.thumb) thumbs.set(item.id, item.thumb);
    while (thumbs.size > POSTER_CACHE_LIMIT) thumbs.delete(thumbs.keys().next().value!);
  };
  const client = (context: ApiContext): PlexBrowseClient | Response => {
    const found = plex();
    return "disabled" in found ? context.json({ error: `Plex isn't configured: ${found.disabled}` }, 503) : found;
  };
  const failure = (context: ApiContext, error: unknown) => {
    if (error instanceof PlexError) return context.json({ error: error.message }, 502);
    if (error instanceof RoomControlError) return context.json({ error: error.message }, error.status);
    if (error instanceof HomeAssistantError) return context.json({ error: error.message }, 502);
    throw error;
  };

  api.get("/alexa/plex", async (context) => {
    const found = plex();
    if ("disabled" in found) return context.json({ enabled: false, reason: found.disabled, libraries: [] });
    try {
      return context.json({ enabled: true, libraries: await found.libraries() });
    } catch (error) {
      return failure(context, error);
    }
  });

  api.get("/alexa/plex/deck", async (context) => {
    const found = client(context);
    if (found instanceof Response) return found;
    try {
      const deck = await found.onDeck(20);
      remember(deck);
      return context.json({ items: deck.map((item) => ({ ...publicItem(item), chapters: [] })) });
    } catch (error) {
      return failure(context, error);
    }
  });

  // ?q= searches every library; otherwise one page of ?libraryId= in ?sort= order.
  api.get("/alexa/plex/library", async (context) => {
    const found = client(context);
    if (found instanceof Response) return found;
    const query = (context.req.query("q") ?? "").trim().slice(0, 200);
    const page = Math.max(0, Math.floor(Number(context.req.query("page")) || 0));
    try {
      if (query) {
        const items = await found.search(query, 30);
        remember(items);
        return context.json({ items: items.map(publicSummary), total: items.length, page: 0, pageSize: items.length });
      }
      const libraryId = context.req.query("libraryId") ?? "";
      if (!isPlexId(libraryId)) return context.json({ error: "libraryId is required" }, 400);
      const asked = context.req.query("sort") ?? "";
      const sort: PlexLibrarySort = Object.hasOwn(PLEX_LIBRARY_SORTS, asked) ? asked as PlexLibrarySort : "newest";
      const result = await found.libraryItems(libraryId, { start: page * PAGE_SIZE, size: PAGE_SIZE, sort });
      remember(result.items);
      return context.json({ items: result.items.map(publicSummary), total: result.total, page, pageSize: PAGE_SIZE });
    } catch (error) {
      return failure(context, error);
    }
  });

  // A movie or episode with its chapters; a show with its episodes, grouped by season, and the one to carry on with.
  api.get("/alexa/plex/items/:id", async (context) => {
    const found = client(context);
    if (found instanceof Response) return found;
    const id = context.req.param("id");
    if (!isPlexId(id)) return context.json({ error: "not found" }, 404);
    try {
      const summary = await found.summary(id);
      if (!summary) return context.json({ error: "not found" }, 404);
      remember([summary]);
      if (summary.type === "show") {
        const episodes = await found.episodes(id);
        remember(episodes);
        const next = nextUp(episodes);
        const seasons = [...new Set(episodes.map((episode) => episode.season ?? 0))].sort((a, b) => a - b)
          .map((season) => ({ season, episodes: episodes.filter((episode) => (episode.season ?? 0) === season).map((episode) => ({ ...publicItem(episode), chapters: [] })) }));
        return context.json({ show: { ...publicSummary(summary), overview: summary.overview, nextUpId: next?.id ?? null, seasons } });
      }
      const item = await found.item(id);
      return item ? context.json({ item: { ...publicItem(item), overview: summary.overview } }) : context.json({ error: "not found" }, 404);
    } catch (error) {
      return failure(context, error);
    }
  });

  api.get("/alexa/plex/items/:id/poster", async (context) => {
    const found = client(context);
    if (found instanceof Response) return found;
    const id = context.req.param("id");
    if (!isPlexId(id)) return context.json({ error: "not found" }, 404);
    const thumb = thumbs.get(id) ?? (await found.summary(id).catch(() => null))?.thumb ?? "";
    const upstream = thumb ? await found.image(thumb, context.req.raw.signal).catch(() => null) : null;
    if (!upstream?.ok || !upstream.body) return context.json({ error: "not found" }, 404);
    return new Response(upstream.body, { headers: { "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  });

  // Starts a movie or an episode on the room's Echo: { itemId, startSeconds? }. Without a start, from its saved place.
  api.post("/alexa/rooms/:room/plex", async (context) => {
    const room = normalizeRoomName(context.req.param("room"));
    const body = await context.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!room || !body) return context.json({ error: "invalid room or body" }, 400);
    const itemId = typeof body.itemId === "string" ? body.itemId : "";
    if (!isPlexId(itemId)) return context.json({ error: "itemId is required" }, 400);
    const found = client(context);
    if (found instanceof Response) return found;
    let item: PlexItem | null;
    try {
      item = await found.item(itemId);
    } catch (error) {
      return failure(context, error);
    }
    if (!item) return context.json({ error: "Plex has no such movie or episode" }, 404);
    let startSeconds: number | null = null;
    if (body.startSeconds != null) {
      const seconds = Number(body.startSeconds);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds >= item.duration) return context.json({ error: "startSeconds is outside the title" }, 400);
      startSeconds = seconds;
    }
    const ready = dependencies.controls();
    if (typeof ready === "string") return context.json({ error: ready }, 503);
    try {
      return context.json(await playRoomPlex(ready, dependencies.currentUserId(context), room, { itemId, startSeconds }, dependencies.picks));
    } catch (error) {
      return failure(context, error);
    }
  });
}
