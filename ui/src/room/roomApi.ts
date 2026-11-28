import { http } from "../apiHttp";
import type { MusicSeed } from "../music/musicApi";

/** Which skill, or Home Assistant, a room's screen is showing. */
export type RoomOrigin = "music" | "video" | "books" | "movies" | "home-assistant";
export type AlexaSkill = "music" | "video" | "books" | "movies";

/** Where a book is, for Hoban Books: its chapter and the whole book. Milliseconds, worked out when the response was sent. */
export type RoomBookProgress = {
  bookId: string; author: string; chapterTitle: string | null; chapterIndex: number | null; chapterCount: number;
  chapterPositionMs: number | null; chapterDurationMs: number | null; bookPositionMs: number; bookDurationMs: number;
};

/** What the room's screen should show, as `GET /api/alexa/rooms` works it out. */
export type RoomCurrent = {
  origin: RoomOrigin;
  /** Our skills: the song's or video's ID, or the book's Audiobookshelf ID. */
  videoId?: string | null;
  /** Our skills: playing, paused, stopped, finished, failed. Home Assistant: playing, paused. */
  state: string;
  title: string | null;
  artist: string | null;
  art: string | null;
  durationMs: number | null;
  /** Worked out when the response was sent. */
  positionMs: number | null;
  /** For a book, positionMs and durationMs are the chapter's; this has the whole book. */
  book?: RoomBookProgress | null;
  /** Home Assistant's input name (Local Speaker…); null for our skills. */
  source: string | null;
};

export type RoomNowPlaying = {
  skill: AlexaSkill; videoId: string; title: string; artist: string; art: string; durationMs: number | null;
  state: string; offsetMs: number; startedAt: string | null; positionMs: number; updatedAt: string; book?: RoomBookProgress | null;
};

/** A play sent to an Echo that it hasn't started yet. */
export type RoomPendingPlay = {
  skill: AlexaSkill; videoId: string; title: string; artist: string; art: string; durationMs: number | null; requestedAt: string;
};

export type RoomHomeAssistant = {
  entity: string;
  error: string | null;
  state?: string;
  title?: string | null;
  artist?: string | null;
  art?: string | null;
  /** 0 to 1. */
  volume?: number | null;
  muted?: boolean | null;
  changedAt?: string | null;
  /** The Echo lets Home Assistant move within what it plays. */
  canSeek?: boolean;
};

export type RoomDevice = {
  skill: AlexaSkill; deviceId: string; room: string | null; pairedAt: string | null; lastSeenAt: string;
  nowPlaying: RoomNowPlaying | null; pending: RoomPendingPlay | null;
};

export type AlexaRoom = {
  room: string;
  nowPlaying: RoomNowPlaying | null;
  pending: RoomPendingPlay | null;
  homeAssistant: RoomHomeAssistant | null;
  current: RoomCurrent | null;
  devices: RoomDevice[];
};

export type AlexaRooms = {
  serverTime: string;
  rooms: AlexaRoom[];
  unpaired: RoomDevice[];
  pairing: { room: string; expiresAt: string; claimed: AlexaSkill[] } | null;
};

export type RoomAction = { action: "pause" } | { action: "resume" } | { action: "next" } | { action: "previous" } | { action: "volume"; volume: number }
  /** Seconds forward, or back when negative. */
  | { action: "skip"; seconds: number }
  /** A place to jump to, in seconds: in the song or video, or in the whole book. */
  | { action: "seek"; seconds: number };

/** A room's recent plays, newest first. */
export type RoomHistoryItem = { skill: AlexaSkill; itemId: string; title: string; artist: string; art: string; playedAt: string };
/** What the room's music plays next: a saved queue's songs, or the one song a station has picked. */
export type RoomUpcoming = { playing: boolean; station: boolean; songs: { videoId: string; title: string; artist: string; art: string; durationMs: number | null }[] };

/** A station the music skill can start: what the music pages play, less a single track. */
export type RoomSeed = Exclude<MusicSeed, { kind: "track" }>;

export type RoomQueue = { queueId: string; room: string; title: string; seed: RoomSeed | null; videoIds: string[]; savedAt: string };

/** A video by id; one YT Zero doesn't have (a search result) also carries the title and channel to ask the Echo for. */
export type RoomVideoRequest = { kind: "video"; videoId: string; title?: string; channel?: string } | { kind: "latest" | "shuffle"; channelId: string };

export type HomeAssistantPlayers = {
  enabled: boolean;
  reason?: string;
  mediaPlayers: { entity: string; name: string | null; state: string; alexa: boolean }[];
};

export type RoomPairResult = { room: string; entity: string; paired: AlexaSkill[]; failed: { skill: AlexaSkill; reason: string }[] };

/** A book from Audiobookshelf in a list. Seconds. */
export type RoomBookSummary = {
  id: string; libraryId: string; title: string; author: string; seriesName: string | null; duration: number; numChapters: number;
  progress: { currentTime: number; progress: number; isFinished: boolean } | null;
};

/** The library's order: newest added, a shuffle, or by title. */
export type RoomLibrarySort = "newest" | "random" | "title";

export type RoomBookChapter = { index: number; start: number; end: number; title: string };

export type RoomBook = {
  id: string; libraryId: string; title: string; subtitle: string | null; author: string; narrator: string | null;
  series: { id: string; name: string; sequence: string | null }[]; duration: number; files: number; chapters: RoomBookChapter[];
  progress: { currentTime: number; progress: number; isFinished: boolean; lastUpdate: number } | null;
};

/** The book queued for a room, which "ask hoban books to play my book" plays. */
export type RoomQueuedBook = { room: string; bookId: string; title: string; startSeconds: number | null; savedAt: string };

const room = (name: string) => `/alexa/rooms/${encodeURIComponent(name)}`;

/** The Books tab's conversation with the server: Audiobookshelf, through YT Zero. */
export const roomBooksApi = {
  status: () => http<{ enabled: boolean; reason?: string; libraries: { id: string; name: string }[] }>("/alexa/books"),
  continueListening: async () => (await http<{ books: RoomBookSummary[] }>("/alexa/books/continue")).books,
  library: (query: string, page: number, sort: RoomLibrarySort = "newest") => http<{ books: RoomBookSummary[]; total: number; page: number; pageSize: number }>(
    `/alexa/books/library?${new URLSearchParams(query ? { q: query } : { page: String(page), sort })}`),
  book: async (id: string) => (await http<{ book: RoomBook }>(`/alexa/books/items/${encodeURIComponent(id)}`)).book,
  coverUrl: (id: string) => `/api/alexa/books/items/${encodeURIComponent(id)}/cover`,
  /** The book's sentences, each at its second in the audiobook, from its read-aloud EPUB; [] when it has none. */
  readAlong: async (id: string) => (await http<{ lines: { time: number; text: string }[] }>(`/alexa/books/items/${encodeURIComponent(id)}/readalong`)).lines,
  queued: async (name: string) => (await http<{ book: RoomQueuedBook | null }>(`${room(name)}/book`)).book,
  /** Queues a book for the room, from a chapter or its saved place, and starts it on the room's Echo. */
  play: (name: string, request: { bookId: string; chapter?: number }) =>
    http<{ book: RoomQueuedBook; error?: string }>(`${room(name)}/book`, { method: "PUT", body: JSON.stringify({ ...request, play: true }) }),
};

export type RoomPlexSort = "newest" | "title";
/** The highest age rating to list; each includes those below it, movie and TV alike ("pg" is G, PG, TV-Y to TV-PG). */
export type RoomPlexRating = "g" | "pg" | "pg13" | "r" | "all";
export interface RoomPlexLibrary { id: string; type: "movie" | "show"; title: string }
/** A movie, show or episode in a list. Times are seconds. */
export interface RoomPlexSummary {
  id: string; type: "movie" | "show" | "episode"; title: string; year: number | null; showTitle: string | null;
  duration: number; viewOffset: number; watched: boolean; leafCount: number; viewedLeafCount: number;
}
/** A movie or an episode, with where it would resume and its chapters. */
export interface RoomPlexItem {
  id: string; type: "movie" | "episode"; title: string; year: number | null; show: { id: string; title: string } | null;
  season: number | null; episode: number | null; duration: number; viewOffset: number; watched: boolean; resumeAt: number;
  chapters: { index: number; title: string; start: number; end: number }[]; overview?: string;
}
export interface RoomPlexShow extends RoomPlexSummary { overview: string; nextUpId: string | null; seasons: { season: number; episodes: RoomPlexItem[] }[] }

/** Hoban Plex for the room: Plex's movie and TV libraries, and starting a title on the room's Echo. */
export const roomPlexApi = {
  status: () => http<{ enabled: boolean; reason?: string; libraries: RoomPlexLibrary[] }>("/alexa/plex"),
  onDeck: async (rating: RoomPlexRating) => (await http<{ items: RoomPlexItem[] }>(`/alexa/plex/deck?rating=${rating}`)).items,
  library: (request: ({ query: string } | { libraryId: string; page: number; sort: RoomPlexSort }) & { rating: RoomPlexRating }) => http<{ items: RoomPlexSummary[]; total: number; page: number; pageSize: number }>(
    `/alexa/plex/library?${new URLSearchParams({ rating: request.rating, ...("query" in request ? { q: request.query } : { libraryId: request.libraryId, page: String(request.page), sort: request.sort }) })}`),
  item: (id: string) => http<{ item: RoomPlexItem } | { show: RoomPlexShow }>(`/alexa/plex/items/${encodeURIComponent(id)}`),
  posterUrl: (id: string) => `/api/alexa/plex/items/${encodeURIComponent(id)}/poster`,
  /** Starts a movie or an episode on the room's Echo: from `startSeconds`, or else from its saved place. */
  play: (name: string, request: { itemId: string; startSeconds?: number }) =>
    http<{ via: string; error?: string }>(`${room(name)}/plex`, { method: "POST", body: JSON.stringify(request) }),
};
const send = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

/** The room page's conversation with the server: the Alexa rooms API, signed in as the profile the skills play as. */
export const roomApi = {
  rooms: () => http<AlexaRooms>("/alexa/rooms"),
  control: (name: string, action: RoomAction) => http<{ via: string }>(`${room(name)}/control`, send("POST", action)),
  queue: async (name: string) => (await http<{ queue: RoomQueue | null }>(`${room(name)}/queue`)).queue,
  /** Saves the room's queue and starts it on the room's Echo. */
  playQueue: (name: string, queue: { title: string } & ({ videoIds: string[] } | { seed: RoomSeed })) =>
    http<{ queue: RoomQueue; error?: string }>(`${room(name)}/queue`, send("PUT", { ...queue, play: true })),
  history: async (name: string, skill: AlexaSkill) => (await http<{ items: RoomHistoryItem[] }>(`${room(name)}/history?skill=${skill}`)).items,
  upcoming: (name: string) => http<RoomUpcoming>(`${room(name)}/upcoming`),
  replayQueue: (name: string) => http<{ via: string }>(`${room(name)}/queue/play`, send("POST")),
  playVideo: (name: string, request: RoomVideoRequest) => http<{ via: string }>(`${room(name)}/video`, send("POST", request)),
  homeAssistant: (all = false) => http<HomeAssistantPlayers>(`/alexa/home-assistant${all ? "?all=1" : ""}`),
  setEntity: (name: string, entity: string | null) => http<{ room: string; entity: string | null }>(`${room(name)}/entity`, send("PUT", { entity })),
  pair: (name: string) => http<RoomPairResult>(`${room(name)}/pair`, send("POST")),
  /** Keeps a wall tablet signed in: extends this browser's session by another full lifetime. */
  renewSession: () => http<{ ok: true; renewed: boolean }>("/auth/session/renew", send("POST"), { suppressAuthenticationNavigation: true }),
};
