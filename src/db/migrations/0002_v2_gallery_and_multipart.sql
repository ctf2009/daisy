ALTER TABLE albums ADD COLUMN is_viewable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE uploads ADD COLUMN content_hash TEXT;
ALTER TABLE uploads ADD COLUMN multipart_upload_id TEXT;

CREATE TABLE IF NOT EXISTS upload_parts (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL REFERENCES uploads(id),
  part_number INTEGER NOT NULL,
  etag TEXT NOT NULL,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_uploads_content_hash ON uploads(album_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_upload_parts_upload_id ON upload_parts(upload_id);
