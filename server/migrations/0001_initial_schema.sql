-- Users (auto-created from Cloudflare Access JWT)
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Children
CREATE TABLE children (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  birth_date TEXT NOT NULL,
  picture_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Many-to-many: users <-> children
CREATE TABLE user_children (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, child_id)
);

-- Feedings
CREATE TABLE feedings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('breast_left', 'breast_right', 'both_breasts', 'bottle', 'solid', 'fortified_breast_milk')),
  start_time TEXT NOT NULL,
  end_time TEXT,
  amount REAL,
  amount_unit TEXT CHECK(amount_unit IN ('ml', 'oz', 'g')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_feedings_child_id ON feedings(child_id);
CREATE INDEX idx_feedings_start_time ON feedings(start_time);

-- Diaper changes
CREATE TABLE diaper_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  time TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('wet', 'solid', 'both')),
  color TEXT CHECK(color IN ('black', 'brown', 'green', 'yellow', 'white', '')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_diaper_changes_child_id ON diaper_changes(child_id);
CREATE INDEX idx_diaper_changes_time ON diaper_changes(time);

-- Sleep
CREATE TABLE sleep (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  start_time TEXT NOT NULL,
  end_time TEXT,
  is_nap INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sleep_child_id ON sleep(child_id);
CREATE INDEX idx_sleep_start_time ON sleep(start_time);

-- Tummy time
CREATE TABLE tummy_time (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  start_time TEXT NOT NULL,
  end_time TEXT,
  milestone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tummy_time_child_id ON tummy_time(child_id);
CREATE INDEX idx_tummy_time_start_time ON tummy_time(start_time);

-- Pumping
CREATE TABLE pumping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  start_time TEXT NOT NULL,
  end_time TEXT,
  amount REAL,
  amount_unit TEXT CHECK(amount_unit IN ('ml', 'oz')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_pumping_child_id ON pumping(child_id);
CREATE INDEX idx_pumping_start_time ON pumping(start_time);

-- Growth measurements
CREATE TABLE growth (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  weight REAL,
  weight_unit TEXT CHECK(weight_unit IN ('kg', 'lb', 'oz', 'g')),
  height REAL,
  height_unit TEXT CHECK(height_unit IN ('cm', 'in')),
  head_circumference REAL,
  head_circumference_unit TEXT CHECK(head_circumference_unit IN ('cm', 'in')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_growth_child_id ON growth(child_id);
CREATE INDEX idx_growth_date ON growth(date);

-- Temperature readings
CREATE TABLE temperature (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  time TEXT NOT NULL,
  reading REAL NOT NULL,
  reading_unit TEXT NOT NULL CHECK(reading_unit IN ('F', 'C')) DEFAULT 'F',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_temperature_child_id ON temperature(child_id);
CREATE INDEX idx_temperature_time ON temperature(time);

-- Freeform notes
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  time TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_notes_child_id ON notes(child_id);
CREATE INDEX idx_notes_time ON notes(time);

-- Active timers
CREATE TABLE timers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_timers_child_id ON timers(child_id);
CREATE INDEX idx_timers_user_id ON timers(user_id);
CREATE INDEX idx_timers_is_active ON timers(is_active);
