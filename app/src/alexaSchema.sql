-- Echo devices the Alexa skills have heard from, keyed by the opaque device
-- ID Amazon sends with every request. Each skill sees a different ID for the
-- same Echo, so one Echo has a row per skill, and both rows name the same
-- room. Instance-local: the skills are configured by machine-bound
-- environment variables, and these rows mean nothing to another server.
CREATE TABLE IF NOT EXISTS alexa_devices (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill        TEXT NOT NULL CHECK (skill IN ('music', 'video')),
  device_id    TEXT NOT NULL,
  -- NULL until the Echo is paired with a room.
  room         TEXT,
  paired_at    TEXT,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (user_id, skill, device_id)
);

-- What each device is playing, from the skill's Play directives and the
-- Echo's AudioPlayer events. Transient: the next event rewrites it.
CREATE TABLE IF NOT EXISTS alexa_now_playing (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill       TEXT NOT NULL CHECK (skill IN ('music', 'video')),
  device_id   TEXT NOT NULL,
  token       TEXT NOT NULL,
  video_id    TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  artist      TEXT NOT NULL DEFAULT '',
  art         TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER,
  state       TEXT NOT NULL CHECK (state IN ('playing', 'paused', 'stopped', 'finished', 'failed')),
  -- The position Alexa last reported. Alexa reports it only on events.
  offset_ms   INTEGER NOT NULL DEFAULT 0,
  -- While playing, when position 0 was, so a client can draw live progress.
  started_at  TEXT,
  -- The stream queued to play next, which becomes current when it starts.
  next_token  TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, skill, device_id)
);

-- A room waiting to be paired: set just before "pair" is spoken to one Echo,
-- claimed once by each skill. Transient.
CREATE TABLE IF NOT EXISTS alexa_pairing (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  room       TEXT NOT NULL,
  -- The skills that already paired against it, comma-separated.
  claimed    TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL
);

-- A stream the skill sent in answer to a device, until an Echo reports it
-- started. Alexa may play it on another Echo, which then takes it over.
-- Transient.
CREATE TABLE IF NOT EXISTS alexa_pending_play (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill        TEXT NOT NULL CHECK (skill IN ('music', 'video')),
  device_id    TEXT NOT NULL,
  token        TEXT NOT NULL,
  video_id     TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  artist       TEXT NOT NULL DEFAULT '',
  art          TEXT NOT NULL DEFAULT '',
  duration_ms  INTEGER,
  offset_ms    INTEGER NOT NULL DEFAULT 0,
  requested_at TEXT NOT NULL,
  PRIMARY KEY (user_id, skill, device_id)
);

-- A room's own settings, apart from its devices: the Home Assistant
-- media_player entity of its Echo, for typed commands and for what Home
-- Assistant sees playing there. Instance-local, like the devices: the entity
-- belongs to this server's Home Assistant.
CREATE TABLE IF NOT EXISTS alexa_rooms (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- lower(room), so Kitchen and kitchen are one room.
  room_key   TEXT NOT NULL,
  room       TEXT NOT NULL,
  ha_entity  TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, room_key)
);

-- What "play my queue" plays in a room: a list of songs, or a station seed
-- such as an album. The stream token carries only queue_id and a position, so
-- a long queue stays here. Transient: replaced by the next queue.
CREATE TABLE IF NOT EXISTS alexa_room_queues (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_key  TEXT NOT NULL,
  queue_id  TEXT NOT NULL,
  title     TEXT NOT NULL DEFAULT '',
  -- A station seed as JSON, or NULL for a list of songs.
  seed      TEXT,
  -- The songs' 11-character video IDs, run together.
  video_ids TEXT NOT NULL DEFAULT '',
  saved_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, room_key)
);
