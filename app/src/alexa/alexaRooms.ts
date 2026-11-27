import { database } from "../database";
import type { AsyncDatabaseClient } from "../databaseClient";
import type { AlexaSkillKind, NowPlaying, NowPlayingState, PendingPlay } from "./alexaNowPlaying";

/** How long a room set by the API waits for "pair" to be spoken to an Echo. */
export const ALEXA_PAIRING_TTL_MS = 2 * 60 * 1000;
export const ALEXA_ROOM_MAX_LENGTH = 60;

export interface AlexaDevice {
  skill: AlexaSkillKind;
  deviceId: string;
  room: string | null;
  pairedAt: string | null;
  lastSeenAt: string;
  nowPlaying: NowPlaying | null;
  pending: PendingPlay | null;
}

interface PendingRow {
  skill: AlexaSkillKind; device_id: string; token: string; video_id: string; title: string; artist: string; art: string;
  duration_ms: number | null; offset_ms: number; requested_at: string;
}

const fromPendingRow = (row: PendingRow): PendingPlay => ({
  token: row.token, videoId: row.video_id, offsetMs: Number(row.offset_ms), requestedAt: row.requested_at,
  item: { title: row.title, artist: row.artist, art: row.art, durationMs: row.duration_ms == null ? null : Number(row.duration_ms) },
});

interface DeviceRow {
  skill: AlexaSkillKind; device_id: string; room: string | null; paired_at: string | null; last_seen_at: string;
}

interface NowPlayingRow {
  skill: AlexaSkillKind; device_id: string; token: string; video_id: string; title: string; artist: string; art: string;
  duration_ms: number | null; state: NowPlayingState; offset_ms: number; started_at: string | null; next_token: string | null; updated_at: string;
}

const fromNowPlayingRow = (row: NowPlayingRow): NowPlaying => ({
  token: row.token, videoId: row.video_id, title: row.title, artist: row.artist, art: row.art,
  durationMs: row.duration_ms == null ? null : Number(row.duration_ms), state: row.state, offsetMs: Number(row.offset_ms),
  startedAt: row.started_at, nextToken: row.next_token, updatedAt: row.updated_at,
});

/**
 * A room name as typed or spoken: trimmed, without a leading "the", and
 * capitalised the way Alexa never does ("the kitchen" is "Kitchen"). Null when
 * nothing is left.
 */
export function normalizeRoomName(value: unknown, spoken = false): string | null {
  if (typeof value !== "string") return null;
  let room = value.replace(/\s+/g, " ").trim();
  if (spoken) {
    room = room.replace(/^(the|my|our)\s+/i, "").replace(/[.!?]+$/, "").trim();
    room = room.replace(/(^|\s)(\p{Ll})/gu, (_, space: string, letter: string) => space + letter.toUpperCase());
  }
  room = room.slice(0, ALEXA_ROOM_MAX_LENGTH).trim();
  return room || null;
}

export function createAlexaRoomStore(db: AsyncDatabaseClient = database) {
  /** A room the profile already has under another capitalisation keeps that spelling. */
  async function canonicalRoom(userId: number, room: string): Promise<string> {
    const row = await db.prepare("SELECT room FROM alexa_devices WHERE user_id = ? AND lower(room) = lower(?) ORDER BY paired_at DESC LIMIT 1")
      .get<{ room: string }>(userId, room);
    return row?.room ?? room;
  }

  async function pairing(userId: number, now: number): Promise<{ room: string; expiresAt: string; claimed: AlexaSkillKind[] } | null> {
    const row = await db.prepare("SELECT room, claimed, expires_at FROM alexa_pairing WHERE user_id = ?")
      .get<{ room: string; claimed: string; expires_at: string }>(userId);
    if (!row || Date.parse(row.expires_at) <= now) return null;
    return { room: row.room, expiresAt: row.expires_at, claimed: row.claimed.split(",").filter(Boolean) as AlexaSkillKind[] };
  }

  return {
    pairing,

    async seen(userId: number, skill: AlexaSkillKind, deviceId: string, now: number): Promise<void> {
      await db.prepare(`INSERT INTO alexa_devices (user_id, skill, device_id, last_seen_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (user_id, skill, device_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`)
        .run(userId, skill, deviceId, new Date(now).toISOString());
    },

    async room(userId: number, skill: AlexaSkillKind, deviceId: string): Promise<string | null> {
      const row = await db.prepare("SELECT room FROM alexa_devices WHERE user_id = ? AND skill = ? AND device_id = ?")
        .get<{ room: string | null }>(userId, skill, deviceId);
      return row?.room ?? null;
    },

    /** Names the device's room, or clears it with null. Returns the room as stored. */
    async setRoom(userId: number, skill: AlexaSkillKind, deviceId: string, room: string | null, now: number): Promise<string | null> {
      const stored = room ? await canonicalRoom(userId, room) : null;
      const at = new Date(now).toISOString();
      await db.prepare(`INSERT INTO alexa_devices (user_id, skill, device_id, room, paired_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, skill, device_id) DO UPDATE SET room = excluded.room, paired_at = excluded.paired_at`)
        .run(userId, skill, deviceId, stored, stored ? at : null, at);
      return stored;
    },

    /** Renames a room on every device in it. Returns how many devices changed. */
    async renameRoom(userId: number, from: string, to: string): Promise<number> {
      const result = await db.prepare("UPDATE alexa_devices SET room = ? WHERE user_id = ? AND lower(room) = lower(?)").run(to, userId, from);
      return result.changes;
    },

    async forget(userId: number, skill: AlexaSkillKind, deviceId: string): Promise<boolean> {
      await db.prepare("DELETE FROM alexa_now_playing WHERE user_id = ? AND skill = ? AND device_id = ?").run(userId, skill, deviceId);
      await db.prepare("DELETE FROM alexa_pending_play WHERE user_id = ? AND skill = ? AND device_id = ?").run(userId, skill, deviceId);
      const result = await db.prepare("DELETE FROM alexa_devices WHERE user_id = ? AND skill = ? AND device_id = ?").run(userId, skill, deviceId);
      return result.changes > 0;
    },

    async devices(userId: number): Promise<AlexaDevice[]> {
      const devices = await db.prepare("SELECT skill, device_id, room, paired_at, last_seen_at FROM alexa_devices WHERE user_id = ? ORDER BY last_seen_at DESC")
        .all<DeviceRow>(userId);
      const playing = await db.prepare("SELECT * FROM alexa_now_playing WHERE user_id = ?").all<NowPlayingRow>(userId);
      const waiting = await db.prepare("SELECT * FROM alexa_pending_play WHERE user_id = ?").all<PendingRow>(userId);
      const key = (row: { skill: string; device_id: string }) => `${row.skill}\n${row.device_id}`;
      const byDevice = new Map(playing.map((row) => [key(row), fromNowPlayingRow(row)]));
      const pendingByDevice = new Map(waiting.map((row) => [key(row), fromPendingRow(row)]));
      return devices.map((row) => ({
        skill: row.skill, deviceId: row.device_id, room: row.room, pairedAt: row.paired_at, lastSeenAt: row.last_seen_at,
        nowPlaying: byDevice.get(key(row)) ?? null,
        pending: pendingByDevice.get(key(row)) ?? null,
      }));
    },

    async pending(userId: number, skill: AlexaSkillKind, deviceId: string): Promise<PendingPlay | null> {
      const row = await db.prepare("SELECT * FROM alexa_pending_play WHERE user_id = ? AND skill = ? AND device_id = ?")
        .get<PendingRow>(userId, skill, deviceId);
      return row ? fromPendingRow(row) : null;
    },

    /** Stores the device's pending play, or clears it with null. */
    async savePending(userId: number, skill: AlexaSkillKind, deviceId: string, pending: PendingPlay | null): Promise<void> {
      if (!pending) {
        await db.prepare("DELETE FROM alexa_pending_play WHERE user_id = ? AND skill = ? AND device_id = ?").run(userId, skill, deviceId);
        return;
      }
      await db.prepare(`INSERT INTO alexa_pending_play
        (user_id, skill, device_id, token, video_id, title, artist, art, duration_ms, offset_ms, requested_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, skill, device_id) DO UPDATE SET
          token = excluded.token, video_id = excluded.video_id, title = excluded.title, artist = excluded.artist, art = excluded.art,
          duration_ms = excluded.duration_ms, offset_ms = excluded.offset_ms, requested_at = excluded.requested_at`)
        .run(userId, skill, deviceId, pending.token, pending.videoId, pending.item.title, pending.item.artist, pending.item.art,
          pending.item.durationMs, Math.floor(pending.offsetMs), pending.requestedAt);
    },

    /** Takes the latest pending play of a stream from any other device: Alexa started it on this one instead. */
    async claimPending(userId: number, skill: AlexaSkillKind, token: string, exceptDeviceId: string): Promise<PendingPlay | null> {
      const row = await db.prepare(`SELECT * FROM alexa_pending_play WHERE user_id = ? AND skill = ? AND token = ? AND device_id <> ?
        ORDER BY requested_at DESC LIMIT 1`).get<PendingRow>(userId, skill, token, exceptDeviceId);
      if (!row) return null;
      await db.prepare("DELETE FROM alexa_pending_play WHERE user_id = ? AND skill = ? AND device_id = ? AND token = ?")
        .run(userId, skill, row.device_id, token);
      return fromPendingRow(row);
    },

    async nowPlaying(userId: number, skill: AlexaSkillKind, deviceId: string): Promise<NowPlaying | null> {
      const row = await db.prepare("SELECT * FROM alexa_now_playing WHERE user_id = ? AND skill = ? AND device_id = ?")
        .get<NowPlayingRow>(userId, skill, deviceId);
      return row ? fromNowPlayingRow(row) : null;
    },

    async saveNowPlaying(userId: number, skill: AlexaSkillKind, deviceId: string, record: NowPlaying): Promise<void> {
      await db.prepare(`INSERT INTO alexa_now_playing
        (user_id, skill, device_id, token, video_id, title, artist, art, duration_ms, state, offset_ms, started_at, next_token, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, skill, device_id) DO UPDATE SET
          token = excluded.token, video_id = excluded.video_id, title = excluded.title, artist = excluded.artist, art = excluded.art,
          duration_ms = excluded.duration_ms, state = excluded.state, offset_ms = excluded.offset_ms, started_at = excluded.started_at,
          next_token = excluded.next_token, updated_at = excluded.updated_at`)
        .run(userId, skill, deviceId, record.token, record.videoId, record.title, record.artist, record.art, record.durationMs,
          record.state, Math.floor(record.offsetMs), record.startedAt, record.nextToken, record.updatedAt);
    },

    async startPairing(userId: number, room: string, now: number): Promise<{ room: string; expiresAt: string }> {
      const stored = await canonicalRoom(userId, room);
      const expiresAt = new Date(now + ALEXA_PAIRING_TTL_MS).toISOString();
      await db.prepare(`INSERT INTO alexa_pairing (user_id, room, claimed, expires_at) VALUES (?, ?, '', ?)
        ON CONFLICT (user_id) DO UPDATE SET room = excluded.room, claimed = '', expires_at = excluded.expires_at`)
        .run(userId, stored, expiresAt);
      return { room: stored, expiresAt };
    },

    async cancelPairing(userId: number): Promise<void> {
      await db.prepare("DELETE FROM alexa_pairing WHERE user_id = ?").run(userId);
    },

    /**
     * The room waiting to be paired, claimed for this skill: each skill claims
     * it once, so the same Echo can pair both skills, and a second Echo asking
     * the same skill gets nothing.
     */
    async claimPairing(userId: number, skill: AlexaSkillKind, now: number): Promise<string | null> {
      const waiting = await pairing(userId, now);
      if (!waiting || waiting.claimed.includes(skill)) return null;
      const claimed = [...waiting.claimed, skill].join(",");
      const result = await db.prepare("UPDATE alexa_pairing SET claimed = ? WHERE user_id = ? AND claimed = ?")
        .run(claimed, userId, waiting.claimed.join(","));
      return result.changes > 0 ? waiting.room : null;
    },
  };
}

export type AlexaRoomStore = ReturnType<typeof createAlexaRoomStore>;
