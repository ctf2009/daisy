CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  access_code TEXT,
  is_open INTEGER NOT NULL DEFAULT 1,
  is_viewable INTEGER NOT NULL DEFAULT 0,
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
  content_hash TEXT,
  multipart_upload_id TEXT,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS upload_parts (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL REFERENCES uploads(id),
  part_number INTEGER NOT NULL,
  etag TEXT NOT NULL,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_uploads_content_hash ON uploads(album_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_upload_parts_upload_id ON upload_parts(upload_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip_address TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_albums_slug ON albums(slug);
CREATE INDEX IF NOT EXISTS idx_uploads_album_id ON uploads(album_id);
CREATE INDEX IF NOT EXISTS idx_albums_owner_email ON albums(owner_email);
