-- Allow a "none" diaper change type for changes that are neither wet, solid, nor both
CREATE TABLE diaper_changes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  time TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('wet', 'solid', 'both', 'none')),
  color TEXT CHECK(color IN ('black', 'brown', 'green', 'yellow', 'white', '')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO diaper_changes_new (id, child_id, time, type, color, notes, created_at, updated_at, created_by_user_id)
SELECT id, child_id, time, type, color, notes, created_at, updated_at, created_by_user_id
FROM diaper_changes;

DROP TABLE diaper_changes;
ALTER TABLE diaper_changes_new RENAME TO diaper_changes;

CREATE INDEX idx_diaper_changes_child_id ON diaper_changes(child_id);
CREATE INDEX idx_diaper_changes_time ON diaper_changes(time);
