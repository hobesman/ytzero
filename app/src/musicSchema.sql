-- Music mode is a separate service that shares the server. Its tables never
-- reference videos or channels, and nothing here feeds the video catalog,
-- watch history, subscriptions or video recommendations.

-- Songs seen through YouTube Music search or radio. Rebuildable cache.
CREATE TABLE IF NOT EXISTS music_tracks (
  video_id   TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '',
  artist     TEXT NOT NULL DEFAULT '',
  artist_id  TEXT,
  album      TEXT,
  duration   INTEGER,
  thumbnail  TEXT NOT NULL DEFAULT '',
  -- 1 for an auto-generated "Topic" audio track, 0 for a music video.
  is_topic   INTEGER NOT NULL DEFAULT 0,
  -- Normalized "artist|title" shared by different uploads of one song.
  song_key   TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_music_tracks_song_key ON music_tracks(song_key);

-- One row per song a profile listened to. Portable personal state.
CREATE TABLE IF NOT EXISTS music_plays (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id         TEXT NOT NULL,
  started_at       TEXT NOT NULL,
  listened_seconds REAL NOT NULL DEFAULT 0,
  duration         REAL,
  -- completed | skipped | stopped
  end_reason       TEXT NOT NULL DEFAULT 'stopped' CHECK (end_reason IN ('completed', 'skipped', 'stopped')),
  station_seed     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_music_plays_identity ON music_plays(user_id, video_id, started_at);
CREATE INDEX IF NOT EXISTS idx_music_plays_recent ON music_plays(user_id, started_at DESC);

-- Liked songs (1) and "not this one" (-1). Portable personal state.
CREATE TABLE IF NOT EXISTS music_ratings (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  rating   INTEGER NOT NULL CHECK (rating IN (1, -1)),
  rated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, video_id)
);
