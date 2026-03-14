-- Per-user settings (default child, theme preference, etc.)
CREATE TABLE user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_child_id INTEGER REFERENCES children(id) ON DELETE SET NULL,
  theme_mode TEXT NOT NULL DEFAULT 'system' CHECK(theme_mode IN ('system', 'light', 'dark')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
