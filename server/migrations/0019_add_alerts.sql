-- The in-app alerts feed: one row per alert the server *decided* to raise,
-- whether or not any push was delivered for it.
--
-- Push is the notification, this is the record. They are deliberately not the
-- same thing:
--
--  * A push swiped off the lock screen is gone. The thing it was telling you
--    about — nobody has logged a feed since 8am — is still true.
--  * A push only reaches the devices that opted in. Two caregivers share a
--    child here and one of them routinely has notifications off, or is on a
--    browser with no Web Push at all (an un-installed iOS tab has no
--    PushManager). Today that person has no way of knowing an alert fired.
--  * On an installed iOS PWA — most of the installs here — push is the least
--    reliable link in the chain. An alert that only ever existed as a push is
--    an alert that may never have existed at all.
--
-- So rows are written at the moment the alert is *decided* (in the cron,
-- alongside the reminder_state / feeding_trend_checks claim), never at
-- delivery, and are written even when nothing is subscribed.
--
-- Unrelated to the ALERT_EMAIL binding, which is where a dead-lettered daily
-- summary gets reported.
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('diaper', 'feeding', 'feeding_trend')),
  -- Short label for the list, e.g. "Diaper reminder". `body` is the sentence
  -- that was pushed, stored as sent rather than re-derived on read — the
  -- figures in a feeding-trend alert describe the moment it was raised, and a
  -- screen that quietly recomputed them against a later clock would be saying
  -- something the alert never said.
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '/',
  -- Identifies the *occasion* this alert was raised for, so a cron that fires
  -- twice cannot double-log it. Deliberately the same identity each caller
  -- already guards its push with: the gap for a reminder
  -- (reminder:<child>:<kind>:<last activity>), the checkpoint for a trend
  -- alert (feeding_trend:<child>:<ET date>:<hour>).
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_alerts_created_at ON alerts(created_at DESC);
CREATE INDEX idx_alerts_child_id ON alerts(child_id);

-- How far each user has read the feed. One row per user rather than one per
-- (user, alert): the bell only needs "how many since you last looked", and
-- opening the drawer answers it for everything at once. Absent row = nothing
-- read yet.
CREATE TABLE alert_reads (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
