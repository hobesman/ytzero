/**
 * A bridge to Home Assistant's Alexa Media Player integration, which can type a
 * command to an Echo ("ask hoban music to pair") and report and control what an
 * Echo plays from sources Amazon shows it, such as Amazon Music. Configured only
 * by machine-bound environment variables, like the skills themselves, and off
 * until both are set.
 */
export interface HomeAssistantConfig {
  /** Home Assistant's address, such as http://homeassistant.local:8123. */
  url: string;
  /** A long-lived access token. A secret: never logged or returned. */
  token: string;
}

/** What each skill is called aloud, for a typed command that has to name it. Books is Hoban Books, the audiobook skill. */
export interface AlexaInvocations {
  music: string | null;
  video: string | null;
  books: string | null;
}

type Environment = Record<string, string | undefined>;

const unquote = (value: string | undefined) => (value ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();

/** The configuration, or why the bridge is off. */
export function homeAssistantConfig(environment: Environment = process.env): HomeAssistantConfig | { disabled: string } {
  const url = unquote(environment.YTZERO_HOME_ASSISTANT_URL).replace(/\/+$/, "");
  const token = unquote(environment.YTZERO_HOME_ASSISTANT_TOKEN);
  if (!url && !token) return { disabled: "YTZERO_HOME_ASSISTANT_URL and YTZERO_HOME_ASSISTANT_TOKEN are not set" };
  if (!url) return { disabled: "YTZERO_HOME_ASSISTANT_URL is not set" };
  if (!token) return { disabled: "YTZERO_HOME_ASSISTANT_TOKEN is not set" };
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { disabled: "YTZERO_HOME_ASSISTANT_URL is not a valid address" }; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { disabled: "YTZERO_HOME_ASSISTANT_URL must start with http:// or https://" };
  return { url: parsed.origin + parsed.pathname.replace(/\/+$/, ""), token };
}

/** Spoken invocation names, lowercase as Alexa hears them; null when not set. */
export function alexaInvocations(environment: Environment = process.env): AlexaInvocations {
  const name = (value: string | undefined) => unquote(value).toLowerCase().replace(/\s+/g, " ") || null;
  return {
    music: name(environment.YTZERO_ALEXA_MUSIC_INVOCATION),
    video: name(environment.YTZERO_ALEXA_VIDEO_INVOCATION),
    books: name(environment.YTZERO_ALEXA_BOOKS_INVOCATION),
  };
}

/** One entity as Home Assistant's REST API reports it. */
export interface HomeAssistantState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

export class HomeAssistantError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
  }
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const ENTITY_ID = /^media_player\.[a-z0-9_]+$/;
export const isMediaPlayerEntity = (value: unknown): value is string => typeof value === "string" && ENTITY_ID.test(value);

/** Home Assistant's REST API, as far as the bridge uses it. */
export function createHomeAssistantClient(config: HomeAssistantConfig, fetcher: Fetch = fetch, timeoutMs = 8000) {
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown, waitMs = timeoutMs): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(`${config.url}${path}`, {
        method,
        headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(waitMs),
      });
    } catch (error) {
      throw new HomeAssistantError(`Home Assistant is unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status === 401 || response.status === 403) throw new HomeAssistantError("Home Assistant refused the access token", response.status);
    if (response.status === 404) throw new HomeAssistantError("Home Assistant has no such entity or service", 404);
    if (!response.ok) throw new HomeAssistantError(`Home Assistant answered ${response.status}`, response.status);
    return await response.json().catch(() => null) as T;
  }

  return {
    /** A shorter waitMs suits a screen that polls. */
    async state(entityId: string, waitMs?: number): Promise<HomeAssistantState> {
      if (!isMediaPlayerEntity(entityId)) throw new HomeAssistantError("not a media_player entity");
      return call<HomeAssistantState>("GET", `/api/states/${entityId}`, undefined, waitMs);
    },

    /** Every media player. Alexa Media Player's carry its own attributes, such as last_called. */
    async mediaPlayers(): Promise<HomeAssistantState[]> {
      const states = await call<HomeAssistantState[]>("GET", "/api/states");
      return (Array.isArray(states) ? states : []).filter((state) => isMediaPlayerEntity(state?.entity_id));
    },

    async service(service: MediaPlayerService, entityId: string, data: Record<string, unknown> = {}): Promise<void> {
      if (!isMediaPlayerEntity(entityId)) throw new HomeAssistantError("not a media_player entity");
      await call("POST", `/api/services/media_player/${service}`, { entity_id: entityId, ...data });
    },

    /** Types a command to the Echo, as if spoken to it after "Alexa". */
    async typeCommand(entityId: string, command: string): Promise<void> {
      await this.service("play_media", entityId, { media_content_type: "custom", media_content_id: command });
    },
  };
}

export type MediaPlayerService = "play_media" | "media_pause" | "media_play" | "media_next_track" | "media_previous_track" | "media_stop" | "volume_set" | "media_seek";
export type HomeAssistantClient = ReturnType<typeof createHomeAssistantClient>;

/** Whether an entity comes from Alexa Media Player, which always reports these attributes. */
export const isAlexaMediaPlayer = (state: HomeAssistantState) => "last_called" in (state.attributes ?? {});

/** What Home Assistant says an Echo is playing, as a client shows it. */
export interface HomeAssistantReport {
  entity: string;
  name: string | null;
  /** playing, paused, idle, standby, unavailable… */
  state: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  art: string | null;
  durationMs: number | null;
  /** Where playback had got to at positionUpdatedAt. */
  offsetMs: number | null;
  positionUpdatedAt: string | null;
  /** That, carried forward to now while playing. */
  positionMs: number | null;
  /** The Echo's input, such as Local Speaker or a Bluetooth device. */
  source: string | null;
  /** 0 to 1. */
  volume: number | null;
  muted: boolean | null;
  changedAt: string | null;
  /** The player says it can seek (supported_features has SEEK). */
  canSeek: boolean;
}

/** Home Assistant's MediaPlayerEntityFeature.SEEK. */
const SUPPORTS_SEEK = 2;

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

export function homeAssistantReport(state: HomeAssistantState, now: number): HomeAssistantReport {
  const attributes = state.attributes ?? {};
  const duration = finite(attributes.media_duration);
  const position = finite(attributes.media_position);
  const updatedAt = text(attributes.media_position_updated_at);
  let positionMs = position == null ? null : position * 1000;
  const updated = updatedAt ? Date.parse(updatedAt) : NaN;
  if (positionMs != null && state.state === "playing" && Number.isFinite(updated)) positionMs += Math.max(0, now - updated);
  if (positionMs != null && duration) positionMs = Math.min(positionMs, duration * 1000);
  // Alexa's art is a public URL; a proxied one (/api/media_player_proxy/…) needs Home Assistant's login.
  const picture = text(attributes.entity_picture);
  return {
    entity: state.entity_id,
    name: text(attributes.friendly_name),
    state: state.state,
    title: text(attributes.media_title),
    artist: text(attributes.media_artist),
    album: text(attributes.media_album_name),
    art: picture && /^https?:\/\//.test(picture) ? picture : null,
    durationMs: duration == null ? null : duration * 1000,
    offsetMs: position == null ? null : position * 1000,
    positionUpdatedAt: updatedAt,
    positionMs: positionMs == null ? null : Math.round(positionMs),
    source: text(attributes.source),
    volume: finite(attributes.volume_level),
    muted: typeof attributes.is_volume_muted === "boolean" ? attributes.is_volume_muted : null,
    changedAt: state.last_changed ?? null,
    canSeek: (Number(attributes.supported_features) & SUPPORTS_SEEK) !== 0,
  };
}

/** Home Assistant shows something playing or paused that it can see (Amazon Music, say). Our skills' audio shows as idle. */
export const homeAssistantSeesMedia = (report: Pick<HomeAssistantReport, "state" | "title">) =>
  (report.state === "playing" || report.state === "paused") && Boolean(report.title);
