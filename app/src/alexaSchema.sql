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
