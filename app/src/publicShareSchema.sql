-- Per-link playback grants and limits for public share links. Like
-- public_shares itself this is instance-local security state and never part
-- of a portable backup. A missing row means a link with no server streaming
-- and no limits.
CREATE TABLE IF NOT EXISTS public_share_limits (
  share_id            TEXT PRIMARY KEY REFERENCES public_shares(id) ON DELETE CASCADE,
  -- 1 lets anonymous visitors stream non-local videos through this server
  -- (yt-dlp with the owner's YouTube session and the server's address).
  allow_server_stream INTEGER NOT NULL DEFAULT 0 CHECK (allow_server_stream IN (0,1)),
  -- NULL means no play limit.
  max_plays           INTEGER CHECK (max_plays IS NULL OR max_plays > 0),
  play_count          INTEGER NOT NULL DEFAULT 0,
  -- ISO timestamp; NULL means the link does not expire.
  expires_at          TEXT,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per visitor and video that used up a play, so seeking, range
-- requests and reloads do not count again. visitor_key is a hash of the share,
-- client address and user agent, never the address itself. Transient.
CREATE TABLE IF NOT EXISTS public_share_plays (
  share_id    TEXT NOT NULL REFERENCES public_shares(id) ON DELETE CASCADE,
  visitor_key TEXT NOT NULL,
  video_id    TEXT NOT NULL,
  played_at   TEXT NOT NULL,
  PRIMARY KEY (share_id, visitor_key, video_id)
);
