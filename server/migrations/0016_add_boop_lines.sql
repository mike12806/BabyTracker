-- A pool of short "boop" reaction lines — the ones ChildHero cycles through
-- when someone taps a child's photo (see client/src/utils/childMoments.ts).
--
-- The app ships with a fixed set of those baked into the client. This table
-- is a second, growing set written by a low-frequency cron
-- (refreshBoopLines, server/src/scheduled/boopLines.ts) that asks a model for
-- a handful more in the same voice every so often, so the joke doesn't go
-- stale after the thousandth tap without anyone having to hand-write new
-- ones. The client merges this pool with its built-in lines and falls back to
-- just the built-ins when the table is empty or the request fails — nothing
-- here is required for the feature to work.
CREATE TABLE IF NOT EXISTS boop_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Which cycle the line belongs to: the daytime set or the after-hours one.
  -- Mirrors the two lists in boopMessage() client-side.
  mood TEXT NOT NULL CHECK(mood IN ('day', 'night')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- The pool read is "give me the current lines for this mood" — newest first,
-- so a freshly generated line is what a pruning pass keeps.
CREATE INDEX IF NOT EXISTS idx_boop_lines_mood_created
  ON boop_lines (mood, created_at DESC, id DESC);
