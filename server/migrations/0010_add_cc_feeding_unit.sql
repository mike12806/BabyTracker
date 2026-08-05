-- Allow 'cc' as a feeding amount unit alongside ml, oz and g.
-- SQLite can't alter a CHECK constraint in place, so the table is rebuilt.
CREATE TABLE feedings_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('breast_left', 'breast_right', 'both_breasts', 'bottle_breast_milk', 'bottle_formula', 'solid', 'fortified_breast_milk')),
  start_time TEXT NOT NULL,
  end_time TEXT,
  amount REAL,
  amount_unit TEXT CHECK(amount_unit IN ('ml', 'oz', 'g', 'cc')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO feedings_new (id, child_id, type, start_time, end_time, amount, amount_unit, notes, created_at, updated_at, created_by_user_id)
SELECT id, child_id, type, start_time, end_time, amount, amount_unit, notes, created_at, updated_at, created_by_user_id
FROM feedings;

DROP TABLE feedings;
ALTER TABLE feedings_new RENAME TO feedings;

CREATE INDEX idx_feedings_child_id ON feedings(child_id);
CREATE INDEX idx_feedings_start_time ON feedings(start_time);
