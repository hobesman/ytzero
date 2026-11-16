import { createHash } from "node:crypto";
import { database } from "./database";

/** New links stop after this many plays... */
export const PUBLIC_SHARE_DEFAULT_MAX_PLAYS = 10;
/** ...or after this many hours, whichever comes first. */
export const PUBLIC_SHARE_DEFAULT_EXPIRY_HOURS = 48;
export const PUBLIC_SHARE_MAX_PLAYS_CEILING = 100_000;
export const PUBLIC_SHARE_MAX_EXPIRY_HOURS = 24 * 366;

export interface PublicShareLimitFields {
  id: string;
  allow_server_stream: number;
  max_plays: number | null;
  play_count: number;
  expires_at: string | null;
}

/** "ok", or why the link no longer admits this visitor. */
export type PublicShareAdmission = "ok" | "expired" | "plays_exhausted";

export interface PublicShareLimitUpdate {
  allowLocalMedia?: boolean;
  allowServerStream?: boolean;
  /** A positive count, or null for no play limit. */
  maxPlays?: number | null;
  /** Hours from now, or null for no expiry. */
  expiresInHours?: number | null;
  resetPlays?: boolean;
}

export function publicShareExpired(share: Pick<PublicShareLimitFields, "expires_at">, now = Date.now()): boolean {
  if (!share.expires_at) return false;
  const at = Date.parse(share.expires_at);
  return Number.isFinite(at) && now >= at;
}

export function publicSharePlaysExhausted(share: Pick<PublicShareLimitFields, "max_plays" | "play_count">): boolean {
  return share.max_plays != null && Number(share.play_count) >= Number(share.max_plays);
}

export function publicShareLimitReason(share: PublicShareLimitFields, now = Date.now()): "expired" | "plays_exhausted" | null {
  if (publicShareExpired(share, now)) return "expired";
  return publicSharePlaysExhausted(share) ? "plays_exhausted" : null;
}

export function publicShareExpiryFromNow(hours: number, now = Date.now()): string {
  return new Date(now + hours * 3_600_000).toISOString();
}

/** A visitor is the client address and user agent, hashed with the share id.
 * The plays table never stores the address itself. */
export function publicShareVisitorKey(shareId: string, address: string, userAgent: string): string {
  return createHash("sha256").update(`${shareId}\n${address}\n${userAgent.slice(0, 512)}`).digest("base64url");
}

export async function insertDefaultPublicShareLimits(shareId: string, now = Date.now()): Promise<void> {
  await database.prepare(`
    INSERT INTO public_share_limits(share_id,allow_server_stream,max_plays,play_count,expires_at,updated_at)
    VALUES(?,0,?,0,?,?) ON CONFLICT(share_id) DO NOTHING
  `).run(shareId, PUBLIC_SHARE_DEFAULT_MAX_PLAYS, publicShareExpiryFromNow(PUBLIC_SHARE_DEFAULT_EXPIRY_HOURS, now), new Date(now).toISOString());
}

async function visitorHasPlay(shareId: string, visitorKey: string, videoId?: string): Promise<boolean> {
  return Boolean(videoId
    ? await database.prepare("SELECT 1 FROM public_share_plays WHERE share_id=? AND visitor_key=? AND video_id=?").get(shareId, visitorKey, videoId)
    : await database.prepare("SELECT 1 FROM public_share_plays WHERE share_id=? AND visitor_key=? LIMIT 1").get(shareId, visitorKey));
}

/** Uses up a play the first time a visitor opens a video. Later requests for
 * the same visitor and video (reloads, seeking, range and segment requests)
 * are free, also after the limit is reached. */
export async function admitPublicSharePlay(share: PublicShareLimitFields, visitorKey: string, videoId: string, now = Date.now()): Promise<PublicShareAdmission> {
  if (publicShareExpired(share, now)) return "expired";
  if (await visitorHasPlay(share.id, visitorKey, videoId)) return "ok";
  if (publicSharePlaysExhausted(share)) return "plays_exhausted";
  const playedAt = new Date(now).toISOString();
  const inserted = await database.prepare(`
    INSERT INTO public_share_plays(share_id,visitor_key,video_id,played_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING
  `).run(share.id, visitorKey, videoId, playedAt);
  if (Number(inserted.changes ?? 0) !== 1) return "ok";
  await database.prepare("INSERT INTO public_share_limits(share_id,updated_at) VALUES(?,?) ON CONFLICT(share_id) DO NOTHING").run(share.id, playedAt);
  const counted = await database.prepare(`
    UPDATE public_share_limits SET play_count=play_count+1
    WHERE share_id=? AND (max_plays IS NULL OR play_count<max_plays)
  `).run(share.id);
  if (Number(counted.changes ?? 0) === 1) return "ok";
  // Another visitor took the last play between the check and the update.
  await database.prepare("DELETE FROM public_share_plays WHERE share_id=? AND visitor_key=? AND video_id=?").run(share.id, visitorKey, videoId);
  return "plays_exhausted";
}

/** For requests that do not start a play (thumbnails, avatars): an exhausted
 * link still serves visitors who already used one of its plays. */
export async function publicShareVisitorAdmitted(share: PublicShareLimitFields, visitorKey: string, now = Date.now()): Promise<PublicShareAdmission> {
  if (publicShareExpired(share, now)) return "expired";
  if (!publicSharePlaysExhausted(share)) return "ok";
  return await visitorHasPlay(share.id, visitorKey) ? "ok" : "plays_exhausted";
}

type ParsedUpdate = { ok: true; update: PublicShareLimitUpdate } | { ok: false; error: string };

function optionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined | "invalid" {
  if (!(key in body)) return undefined;
  return typeof body[key] === "boolean" ? body[key] as boolean : "invalid";
}

function optionalLimit(body: Record<string, unknown>, key: string, ceiling: number): number | null | undefined | "invalid" {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= ceiling ? value : "invalid";
}

/** Validates a management PATCH body. Every field is optional; at least one is required. */
export function parsePublicShareUpdate(raw: unknown): ParsedUpdate {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const allowLocalMedia = optionalBoolean(body, "allow_local_media");
  const allowServerStream = optionalBoolean(body, "allow_server_stream");
  const resetPlays = optionalBoolean(body, "reset_plays");
  const maxPlays = optionalLimit(body, "max_plays", PUBLIC_SHARE_MAX_PLAYS_CEILING);
  const expiresInHours = optionalLimit(body, "expires_in_hours", PUBLIC_SHARE_MAX_EXPIRY_HOURS);
  if (allowLocalMedia === "invalid") return { ok: false, error: "allow_local_media must be boolean" };
  if (allowServerStream === "invalid") return { ok: false, error: "allow_server_stream must be boolean" };
  if (resetPlays === "invalid") return { ok: false, error: "reset_plays must be boolean" };
  if (maxPlays === "invalid") return { ok: false, error: `max_plays must be null or an integer from 1 to ${PUBLIC_SHARE_MAX_PLAYS_CEILING}` };
  if (expiresInHours === "invalid") return { ok: false, error: `expires_in_hours must be null or an integer from 1 to ${PUBLIC_SHARE_MAX_EXPIRY_HOURS}` };
  const update: PublicShareLimitUpdate = { allowLocalMedia, allowServerStream, maxPlays, expiresInHours, resetPlays };
  if (Object.values(update).every((value) => value === undefined)) return { ok: false, error: "no changes" };
  return { ok: true, update };
}

/** Applies the stream grant and limits. Enabling streaming on a link that has
 * neither limit applies the defaults, so the most expensive grant is never
 * unbounded by accident; the owner can remove them afterwards. */
export async function applyPublicShareLimitUpdate(current: PublicShareLimitFields, update: PublicShareLimitUpdate, now = Date.now()): Promise<void> {
  const stamp = new Date(now).toISOString();
  const allowServerStream = update.allowServerStream ?? current.allow_server_stream === 1;
  let maxPlays = update.maxPlays !== undefined ? update.maxPlays : current.max_plays;
  let expiresAt = update.expiresInHours !== undefined
    ? update.expiresInHours === null ? null : publicShareExpiryFromNow(update.expiresInHours, now)
    : current.expires_at;
  const enablingStream = update.allowServerStream === true && current.allow_server_stream !== 1;
  if (enablingStream && maxPlays == null && expiresAt == null && update.maxPlays === undefined && update.expiresInHours === undefined) {
    maxPlays = PUBLIC_SHARE_DEFAULT_MAX_PLAYS;
    expiresAt = publicShareExpiryFromNow(PUBLIC_SHARE_DEFAULT_EXPIRY_HOURS, now);
  }
  await database.prepare("INSERT INTO public_share_limits(share_id,updated_at) VALUES(?,?) ON CONFLICT(share_id) DO NOTHING").run(current.id, stamp);
  await database.prepare(`
    UPDATE public_share_limits SET allow_server_stream=?,max_plays=?,expires_at=?,updated_at=?,
      play_count=CASE WHEN ?=1 THEN 0 ELSE play_count END
    WHERE share_id=?
  `).run(allowServerStream ? 1 : 0, maxPlays, expiresAt, stamp, update.resetPlays ? 1 : 0, current.id);
  if (update.resetPlays) await database.prepare("DELETE FROM public_share_plays WHERE share_id=?").run(current.id);
}
