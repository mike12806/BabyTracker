-- One row per browser/device push subscription. A user can have several
-- (phone + another device), so this is keyed by endpoint, not user_id.
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- Tracks the last reminder sent per (child, kind), so the cron can tell
-- "already nagged, waiting for new activity" from "never nagged." A reminder
-- is only re-sent once a newer activity timestamp than last_notified_at
-- appears — see server/src/scheduled/reminders.ts.
CREATE TABLE reminder_state (
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('diaper', 'feeding')),
  last_notified_at TEXT NOT NULL,
  PRIMARY KEY (child_id, kind)
);
