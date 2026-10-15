CREATE TABLE wishlist (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, version TEXT NOT NULL,
  languages TEXT NOT NULL CHECK (json_valid(languages)),
  initiator TEXT NOT NULL CHECK (initiator IN ('ko','mu','cat','wei','qian')),
  supporters TEXT NOT NULL CHECK (json_valid(supporters)),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
