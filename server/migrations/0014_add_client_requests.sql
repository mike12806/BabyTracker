-- Deduplication log for client-supplied idempotency keys.
--
-- A create request that never delivered its response is indistinguishable, from
-- the client's side, from one that never arrived — so the app can neither retry
-- it nor drop it safely. A key sent with the request makes the answer knowable:
-- the second attempt finds its own key already recorded and returns the row the
-- first attempt created, instead of logging the feed twice.
--
-- Rows are written inside the same transaction as the row they describe, so a
-- key is present if and only if its entry is. Old rows are pruned by the daily
-- cron, being useful only for as long as a client might still retry.
CREATE TABLE IF NOT EXISTS client_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- The uniqueness that makes a replayed request fail rather than duplicate.
-- Scoped per user and per table: keys come from different devices and are only
-- ever compared against the same table they were issued for.
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_requests_key
  ON client_requests (user_id, table_name, client_request_id);

-- Supports the daily prune.
CREATE INDEX IF NOT EXISTS idx_client_requests_created_at
  ON client_requests (created_at);
