-- One short blurb per child per day, shown at the top of the dashboard.
--
-- Cached rather than generated on read: the text is written once by the daily
-- cron, so opening the app never triggers a model call. That is the whole cost
-- story — one inference per child per day regardless of how often anyone looks.
--
-- Kept in D1 rather than KV on purpose. The row is tiny and read a handful of
-- times a day, so KV's edge caching buys nothing here, while D1 gives a
-- strongly consistent read right after the write and keeps the notes as an
-- archive worth looking back through.
CREATE TABLE IF NOT EXISTS child_daily_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  -- The ET calendar day the note is *about* (the day being summarised), not
  -- the day it was written. Matches the daily summary email's window.
  note_date TEXT NOT NULL,
  body TEXT NOT NULL,
  -- 'ai' when a model wrote it, 'fallback' when the deterministic template did.
  -- Worth recording: a run of 'fallback' rows is how you notice the AI binding
  -- is misconfigured, rather than wondering why the writing got flat.
  source TEXT NOT NULL DEFAULT 'ai' CHECK(source IN ('ai', 'fallback')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- One note per child per day. A cron that fires twice, or a manual re-run,
-- updates the existing row instead of stacking a second note behind it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_child_daily_notes_day
  ON child_daily_notes (child_id, note_date);
