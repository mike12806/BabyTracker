-- One row per (child, ET day, checkpoint) feeding-trend check that found a
-- shortfall worth acting on — see server/src/scheduled/feedingTrend.ts.
--
-- Two jobs:
--  1. Idempotency. The row is claimed with INSERT ... ON CONFLICT DO NOTHING
--     *before* anything is sent, so a cron that fires twice for the same
--     checkpoint (a retry, or both the EST and EDT UTC hours landing on the
--     same ET hour after a clock change) cannot push the same alert twice.
--  2. A record of what was decided. `alerted` says whether a push actually
--     went out, `body` is the text that was sent (or would have been), and
--     `source` says whether the model wrote it or the template did. Without
--     this, a model that quietly decides "no alert" every time is invisible
--     from outside the account — the same failure shape the daily note has
--     already been bitten by three times.
--
-- `checkpoint` is the ET hour of the check (11, 16 or 19), not a UTC hour, so
-- the key stays stable across daylight saving.
CREATE TABLE feeding_trend_checks (
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  check_date TEXT NOT NULL,
  checkpoint INTEGER NOT NULL,
  alerted INTEGER NOT NULL DEFAULT 0,
  body TEXT,
  source TEXT NOT NULL DEFAULT 'fallback' CHECK(source IN ('ai', 'fallback')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (child_id, check_date, checkpoint)
);

CREATE INDEX idx_feeding_trend_checks_date ON feeding_trend_checks(check_date DESC);
