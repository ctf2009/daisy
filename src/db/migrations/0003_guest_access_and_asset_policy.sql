ALTER TABLE albums ADD COLUMN asset_policy_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS guest_access_attempts (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL REFERENCES albums(id),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_guest_access_attempts_album_id ON guest_access_attempts(album_id);
