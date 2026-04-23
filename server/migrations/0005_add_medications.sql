-- Medications
CREATE TABLE medications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  time TEXT NOT NULL,
  name TEXT NOT NULL,
  dosage REAL,
  dosage_unit TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_medications_child_id ON medications(child_id);
CREATE INDEX idx_medications_time ON medications(time);
