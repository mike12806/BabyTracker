-- Which alerts each user has dismissed from their feed.
--
-- Per user, not per alert row, because an `alerts` row is shared by everyone
-- linked to that child. One parent tidying their own bell must not take the
-- alert off the other parent's, who may not have read it yet.
--
-- Dismissing hides, it does not delete. The row stays in `alerts` until it
-- ages out of the retention window, so the other reader still has it, an undo
-- is just a delete here, and the record of what was raised stays intact --
-- the whole point of the feed is that it does not depend on someone having
-- caught the notification.
CREATE TABLE alert_dismissals (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_id INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (user_id, alert_id)
);

-- The pruner deletes from `alerts`, and the cascade above needs this to find
-- the dismissals belonging to each departing row without a table scan.
CREATE INDEX idx_alert_dismissals_alert_id ON alert_dismissals(alert_id);
