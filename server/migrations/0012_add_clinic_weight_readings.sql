-- Backfill Nolan's clinic weight readings from 4-9 Aug 2026, which were
-- recorded on paper rather than in the app. Growth rows carry a date but no
-- time, so each reading's time of day is kept in the notes.
--
-- The child is matched by name because row ids differ between environments.
-- A database with no matching child (local dev, tests, a fresh deploy) gets
-- nothing, and both statements skip readings that are already recorded, so
-- re-running this against a database that has them changes nothing.

-- A reading day that already has a growth row — birth measurements, say — has
-- its weight filled in rather than gaining a second row for the same day. Rows
-- that already carry a weight are left untouched.
WITH readings(date, weight, note) AS (
  VALUES
    ('2026-08-04', 8.28, 'Clinic weigh-in, 11:11 AM'),
    ('2026-08-05', 7.83, 'Clinic weigh-in, 12:00 AM'),
    ('2026-08-06', 7.64, 'Clinic weigh-in, 12:10 AM'),
    ('2026-08-07', 7.71, 'Clinic weigh-in, 2:00 AM'),
    ('2026-08-09', 7.63, 'Clinic weigh-in, 9:03 AM')
)
UPDATE growth
SET
  weight = (SELECT r.weight FROM readings r WHERE r.date = growth.date),
  weight_unit = 'lb',
  notes = COALESCE(
    NULLIF(growth.notes, ''),
    (SELECT r.note FROM readings r WHERE r.date = growth.date)
  ),
  updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE growth.weight IS NULL
  AND growth.date IN (SELECT r.date FROM readings r)
  AND growth.child_id IN (SELECT c.id FROM children c WHERE c.first_name = 'Nolan');

-- Every remaining reading day becomes a new weight-only growth entry.
WITH readings(date, weight, note) AS (
  VALUES
    ('2026-08-04', 8.28, 'Clinic weigh-in, 11:11 AM'),
    ('2026-08-05', 7.83, 'Clinic weigh-in, 12:00 AM'),
    ('2026-08-06', 7.64, 'Clinic weigh-in, 12:10 AM'),
    ('2026-08-07', 7.71, 'Clinic weigh-in, 2:00 AM'),
    ('2026-08-09', 7.63, 'Clinic weigh-in, 9:03 AM')
)
INSERT INTO growth (child_id, date, weight, weight_unit, notes)
SELECT c.id, r.date, r.weight, 'lb', r.note
FROM children c
CROSS JOIN readings r
WHERE c.first_name = 'Nolan'
  AND NOT EXISTS (
    SELECT 1 FROM growth g WHERE g.child_id = c.id AND g.date = r.date
  );
