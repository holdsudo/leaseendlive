-- Lease End Live community: episode likes, episode comments, community threads + replies.
-- Everything here is real user activity; nothing is seeded.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,            -- never returned by the public API
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',   -- member | host
  banned INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS magic_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- kind: comment (on an episode) | thread (community post) | reply (in a thread, or a reply to a comment)
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  episode_id TEXT,
  thread_id INTEGER,
  parent_id INTEGER,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT,
  body TEXT NOT NULL,
  flair TEXT,
  status TEXT NOT NULL DEFAULT 'live',   -- live | held | removed
  hold_reason TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS posts_episode ON posts(episode_id, status);
CREATE INDEX IF NOT EXISTS posts_thread ON posts(thread_id, status);
CREATE INDEX IF NOT EXISTS posts_kind ON posts(kind, status, last_activity);

CREATE TABLE IF NOT EXISTS votes (
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id)
);

-- Episode likes need no account: one per device, capped per network.
CREATE TABLE IF NOT EXISTS episode_likes (
  episode_id TEXT NOT NULL,
  device TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (episode_id, device)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  reason TEXT,
  reporter TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (post_id, reporter)
);

CREATE TABLE IF NOT EXISTS rate (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

-- added 2026-10-12
ALTER TABLE posts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
