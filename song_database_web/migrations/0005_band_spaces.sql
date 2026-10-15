CREATE TABLE bands (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','active','rejected','disabled')),
 wish_mode TEXT NOT NULL CHECK(wish_mode IN ('members','text')),
 password_hash TEXT, auth_version INTEGER NOT NULL DEFAULT 1,
 contact_name TEXT NOT NULL DEFAULT '', contact_info TEXT NOT NULL DEFAULT '',
 progress_token TEXT UNIQUE, review_note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, reviewed_at TEXT
);
INSERT INTO bands(id,slug,name,status,wish_mode,created_at) VALUES('krb','krb','KRB','active','members',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE request_limits (bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX request_limits_expiry ON request_limits(expires);
CREATE TABLE songs_multi (
  id TEXT NOT NULL, name TEXT NOT NULL, version TEXT NOT NULL,
  languages TEXT NOT NULL CHECK (json_valid(languages)),
  status TEXT NOT NULL CHECK (status IN ('可演','大饼','取消')),
  revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  band_id TEXT NOT NULL DEFAULT 'krb' REFERENCES bands(id),
  PRIMARY KEY(band_id,id)
);
INSERT INTO songs_multi SELECT *, 'krb' FROM songs;
CREATE TABLE performances_multi (
  id TEXT NOT NULL, date TEXT NOT NULL, name TEXT NOT NULL,
  organizer TEXT NOT NULL, venue TEXT NOT NULL, languages TEXT NOT NULL CHECK (json_valid(languages)),
  status TEXT NOT NULL CHECK (status IN ('计划中','已完成','已取消')),
  completed_at TEXT, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  band_id TEXT NOT NULL DEFAULT 'krb' REFERENCES bands(id),
  PRIMARY KEY(band_id,id)
);
INSERT INTO performances_multi SELECT *, 'krb' FROM performances;
CREATE TABLE setlist_items_multi (
  id TEXT NOT NULL,
  performance_id TEXT NOT NULL,
  song_id TEXT NOT NULL, position INTEGER NOT NULL,
  note TEXT NOT NULL, snapshot TEXT CHECK (snapshot IS NULL OR json_valid(snapshot)),
  band_id TEXT NOT NULL DEFAULT 'krb' REFERENCES bands(id),
  UNIQUE (band_id, performance_id, position),
  PRIMARY KEY(band_id,id),
  FOREIGN KEY(band_id,performance_id) REFERENCES performances_multi(band_id,id) ON DELETE CASCADE,
  FOREIGN KEY(band_id,song_id) REFERENCES songs_multi(band_id,id)
);
INSERT INTO setlist_items_multi SELECT *, 'krb' FROM setlist_items;
CREATE TABLE wishlist_multi (
  id TEXT NOT NULL,
  name TEXT NOT NULL, version TEXT NOT NULL,
  languages TEXT NOT NULL CHECK (json_valid(languages)),
  initiator TEXT NOT NULL,
  supporters TEXT NOT NULL CHECK (json_valid(supporters)),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  band_id TEXT NOT NULL DEFAULT 'krb' REFERENCES bands(id),
  PRIMARY KEY(band_id,id)
);
INSERT INTO wishlist_multi SELECT *, 'krb' FROM wishlist;
CREATE TABLE app_meta_multi (
  id INTEGER NOT NULL CHECK (id = 1),
  generation TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  band_id TEXT NOT NULL DEFAULT 'krb' REFERENCES bands(id),
  PRIMARY KEY(band_id,id)
);
INSERT INTO app_meta_multi SELECT *, 'krb' FROM app_meta;
CREATE TABLE restore_backup_multi (
  id INTEGER NOT NULL CHECK (id = 1),
  created_at TEXT NOT NULL, payload TEXT NOT NULL,
  band_id TEXT NOT NULL DEFAULT 'krb' REFERENCES bands(id),
  PRIMARY KEY(band_id,id)
);
INSERT INTO restore_backup_multi SELECT *, 'krb' FROM restore_backup;
DROP TABLE setlist_items;
DROP TABLE songs;
DROP TABLE performances;
DROP TABLE wishlist;
DROP TABLE app_meta;
DROP TABLE restore_backup;
ALTER TABLE songs_multi RENAME TO songs;
ALTER TABLE performances_multi RENAME TO performances;
ALTER TABLE setlist_items_multi RENAME TO setlist_items;
ALTER TABLE wishlist_multi RENAME TO wishlist;
ALTER TABLE app_meta_multi RENAME TO app_meta;
ALTER TABLE restore_backup_multi RENAME TO restore_backup;
CREATE INDEX setlist_song ON setlist_items(band_id,song_id);
CREATE INDEX songs_created ON songs(band_id,created_at DESC,id);
CREATE INDEX performances_date ON performances(band_id,date,created_at,id);
CREATE INDEX wishlist_created ON wishlist(band_id,created_at DESC,id);
CREATE TRIGGER reject_stale_write BEFORE UPDATE OF revision ON app_meta
WHEN NEW.revision != OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'SETROOM_CONFLICT'); END;
UPDATE app_meta SET generation=lower(hex(randomblob(16))),revision=revision+1;
