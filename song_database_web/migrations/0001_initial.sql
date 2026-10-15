CREATE TABLE app_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generation TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO app_meta VALUES (1, lower(hex(randomblob(16))), 0);

-- A D1 batch is atomic. Reject the entire write if its read snapshot is stale.
CREATE TRIGGER reject_stale_write BEFORE UPDATE OF revision ON app_meta
WHEN NEW.revision != OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'SETROOM_CONFLICT');
END;

CREATE TABLE songs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL,
  languages TEXT NOT NULL CHECK (json_valid(languages)),
  status TEXT NOT NULL CHECK (status IN ('可演','大饼','取消')),
  revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE performances (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, name TEXT NOT NULL,
  organizer TEXT NOT NULL, venue TEXT NOT NULL, languages TEXT NOT NULL CHECK (json_valid(languages)),
  status TEXT NOT NULL CHECK (status IN ('计划中','已完成','已取消')),
  completed_at TEXT, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE setlist_items (
  id TEXT PRIMARY KEY,
  performance_id TEXT NOT NULL REFERENCES performances(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id), position INTEGER NOT NULL,
  note TEXT NOT NULL, snapshot TEXT CHECK (snapshot IS NULL OR json_valid(snapshot)),
  UNIQUE (performance_id, position)
);
CREATE INDEX setlist_song ON setlist_items(song_id);
CREATE TABLE restore_backup (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  created_at TEXT NOT NULL, payload TEXT NOT NULL
);
