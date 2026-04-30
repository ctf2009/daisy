CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  access_code TEXT,
  is_open INTEGER NOT NULL DEFAULT 1,
  welcome_text TEXT,
  background_key TEXT,
  owner_email TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL REFERENCES albums(id),
  r2_key TEXT NOT NULL,
  thumbnail_key TEXT NOT NULL,
  original_filename TEXT,
  content_type TEXT,
  file_size INTEGER,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip_address TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_albums_slug ON albums(slug);
CREATE INDEX IF NOT EXISTS idx_uploads_album_id ON uploads(album_id);
CREATE INDEX IF NOT EXISTS idx_albums_owner_email ON albums(owner_email);
