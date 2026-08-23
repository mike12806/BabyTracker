import { Hono } from "hono";
import type { Env } from "../types/env.js";
import { verifyChildExists } from "./crud.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

/**
 * One row of the merged feed.
 *
 * `detail` is a ready-made sentence built in SQL; the fields after it are the
 * same facts unformatted, so the client can render them the way the rest of
 * the app does. Volumes are the reason: an amount is stored in whatever unit
 * it was logged with, and every screen shows it in the one unit the user
 * picked, which only the client knows. Sending the parts rather than a
 * finished string is what lets the feed say "118 mL" for a bottle logged as
 * 4 oz. `detail` stays for clients that have not been updated yet.
 */
interface ActivityEntry {
  id: number;
  activity_type: string;
  event_time: string;
  detail: string;
  /** Set for entries that run for a stretch of time, once they have finished. */
  end_time: string | null;
  /** The entry's own kind: feeding type, diaper type, nap vs night, pumped side. */
  subtype: string | null;
  /** Free text naming the entry: medication name, note title, tummy-time milestone. */
  label: string | null;
  /** The number the entry carries: a volume, a dose, or a temperature reading. */
  amount: number | null;
  amount_unit: string | null;
  /** Diaper colour, when one was recorded. */
  color: string | null;
  child_name: string;
  logged_by: string;
}

const childNameExpr = `TRIM(c.first_name || CASE WHEN c.last_name IS NOT NULL AND c.last_name != '' THEN ' ' || c.last_name ELSE '' END)`;
const loggedByExpr = `COALESCE(u.name, u.email, 'Unknown')`;

const activity = new Hono<AppEnv>();

// GET /api/activity?child_id=X&limit=Y&offset=Z
// Returns a merged, reverse-chronological activity feed for the given child.
activity.get("/", async (c) => {
  const childId = parseInt(c.req.query("child_id") || "0", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 200);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const dateFrom = c.req.query("date_from") || null;
  const dateTo = c.req.query("date_to") || null;

  if (!childId) {
    return c.json({ error: "child_id is required" }, 400);
  }

  // Verify the child exists. Access is granted to any logged-in user, matching
  // every other read route (`/api/children`, and the child-scoped CRUD routes
  // via `verifyChildExists`). This route used to require a `user_children` row
  // instead, making it the only endpoint a user without one could not read:
  // they saw a working app everywhere else and a bare "No activity yet" here,
  // because the 404 left the feed empty.
  if (!(await verifyChildExists(c.env.DB, childId))) {
    return c.json({ error: "Child not found" }, 404);
  }

  // Validate and normalize date filter values; use open-ended defaults if not provided.
  const fromDate = dateFrom && !isNaN(Date.parse(dateFrom)) ? dateFrom : "0000-01-01T00:00:00.000Z";
  const toDate = dateTo && !isNaN(Date.parse(dateTo)) ? dateTo : "9999-12-31T23:59:59.999Z";

  // The merged page ends at `offset + limit`, and the merge is of lists that
  // are each already in descending order — so an entry past the Nth row of its
  // own table can never place inside the first N of the merge. Each query
  // therefore needs no more than this many rows, however much history exists.
  // Without it every one of these read its table in full and the sort below
  // ran over the lot, which grew unboundedly with the child's history.
  const need = offset + limit;

  // The pager still needs a true count of everything in range, which the capped
  // queries above can no longer give. Table and column names come from this
  // fixed list — never from the request — so they are safe to interpolate;
  // every value is still bound.
  const countSources: Array<[table: string, timeColumn: string]> = [
    ["feedings", "start_time"],
    ["diaper_changes", "time"],
    ["sleep", "start_time"],
    ["tummy_time", "start_time"],
    ["pumping", "start_time"],
    ["temperature", "time"],
    ["notes", "time"],
    ["medications", "time"],
  ];
  // Started before the awaits below so both sets of queries are in flight together.
  const countQueries = countSources.map(([table, timeColumn]) =>
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ${table} WHERE child_id = ? AND ${timeColumn} >= ? AND ${timeColumn} <= ?`
    )
      .bind(childId, fromDate, toDate)
      .first<{ n: number }>()
  );

  const [feedings, diapers, sleepSessions, tummyTimes, pumping, temperatures, notes, medications] =
    await Promise.all([
      c.env.DB.prepare(`
        SELECT 'Feeding' AS activity_type, f.id AS id, f.start_time AS event_time,
          REPLACE(f.type, '_', ' ') AS detail,
          f.end_time AS end_time, f.type AS subtype, NULL AS label,
          f.amount AS amount, f.amount_unit AS amount_unit, NULL AS color,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM feedings f
        JOIN children c ON c.id = f.child_id
        LEFT JOIN users u ON u.id = f.created_by_user_id
        WHERE f.child_id = ? AND f.start_time >= ? AND f.start_time <= ?
        ORDER BY f.start_time DESC LIMIT ?
      `).bind(childId, fromDate, toDate, need).all<ActivityEntry>(),
      c.env.DB.prepare(`
        SELECT 'Diaper Change' AS activity_type, d.id AS id, d.time AS event_time,
          d.type || CASE WHEN d.color IS NOT NULL AND d.color != '' THEN ' (' || d.color || ')' ELSE '' END AS detail,
          NULL AS end_time, d.type AS subtype, NULL AS label,
          NULL AS amount, NULL AS amount_unit, d.color AS color,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM diaper_changes d
        JOIN children c ON c.id = d.child_id
        LEFT JOIN users u ON u.id = d.created_by_user_id
        WHERE d.child_id = ? AND d.time >= ? AND d.time <= ?
        ORDER BY d.time DESC LIMIT ?
      `).bind(childId, fromDate, toDate, need).all<ActivityEntry>(),
      c.env.DB.prepare(`
        SELECT 'Sleep' AS activity_type, s.id AS id, s.start_time AS event_time,
          CASE WHEN s.is_nap = 1 THEN 'nap' ELSE 'night sleep' END AS detail,
          s.end_time AS end_time, CASE WHEN s.is_nap = 1 THEN 'nap' ELSE 'night' END AS subtype, NULL AS label,
          NULL AS amount, NULL AS amount_unit, NULL AS color,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM sleep s
        JOIN children c ON c.id = s.child_id
        LEFT JOIN users u ON u.id = s.created_by_user_id
        WHERE s.child_id = ? AND s.start_time >= ? AND s.start_time <= ?
        ORDER BY s.start_time DESC LIMIT ?
      `).bind(childId, fromDate, toDate, need).all<ActivityEntry>(),
      c.env.DB.prepare(`
        SELECT 'Tummy Time' AS activity_type, t.id AS id, t.start_time AS event_time,
          CASE WHEN t.milestone IS NOT NULL AND t.milestone != '' THEN 'tummy time - ' || t.milestone ELSE 'tummy time' END AS detail,
          t.end_time AS end_time, NULL AS subtype, NULLIF(t.milestone, '') AS label,
          NULL AS amount, NULL AS amount_unit, NULL AS color,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM tummy_time t
        JOIN children c ON c.id = t.child_id
        LEFT JOIN users u ON u.id = t.created_by_user_id
        WHERE t.child_id = ? AND t.start_time >= ? AND t.start_time <= ?
        ORDER BY t.start_time DESC LIMIT ?
      `).bind(childId, fromDate, toDate, need).all<ActivityEntry>(),
      c.env.DB.prepare(`
        SELECT 'Pumping' AS activity_type, p.id AS id, p.start_time AS event_time,
          CASE WHEN p.amount IS NOT NULL THEN 'pumped ' || p.amount || ' ' || COALESCE(p.amount_unit, '') ELSE 'pumping' END
            || CASE p.side WHEN 'left' THEN ' · left breast' WHEN 'right' THEN ' · right breast' WHEN 'both' THEN ' · both breasts' ELSE '' END AS detail,
          p.end_time AS end_time, p.side AS subtype, NULL AS label,
          p.amount AS amount, p.amount_unit AS amount_unit, NULL AS color,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM pumping p
        JOIN children c ON c.id = p.child_id
        LEFT JOIN users u ON u.id = p.created_by_user_id
        WHERE p.child_id = ? AND p.start_time >= ? AND p.start_time <= ?
        ORDER BY p.start_time DESC LIMIT ?
      `).bind(childId, fromDate, toDate, need).all<ActivityEntry>(),
      c.env.DB.prepare(`
        SELECT 'Temperature' AS activity_type, t.id AS id, t.time AS event_time,
          t.reading || '°' || t.reading_unit AS detail,
          NULL AS end_time, NULL AS subtype, NULL AS label,
          t.reading AS amount, t.reading_unit AS amount_unit, NULL AS color,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM temperature t
        JOIN children c ON c.id = t.child_id
        LEFT JOIN users u ON u.id = t.created_by_user_id
        WHERE t.child_id = ? AND t.time >= ? AND t.time <= ?
        ORDER BY t.time DESC LIMIT ?
      `).bind(childId, fromDate, toDate, need).all<ActivityEntry>(),
      c.env.DB.prepare(`
        SELECT 'Note' AS activity_type, n.id AS id, n.time AS event_time,
          COALESCE(n.title, SUBSTR(n.content, 1, 60)) AS detail,
          NULL AS end_time, NULL AS subtype, COALESCE(NULLIF(n.title, ''), SUBSTR(n.content, 1, 60)) AS label,
          NULL AS amount, NULL AS amount_unit, NULL AS color,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM notes n
        JOIN children c ON c.id = n.child_id
        LEFT JOIN users u ON u.id = n.created_by_user_id
        WHERE n.child_id = ? AND n.time >= ? AND n.time <= ?
        ORDER BY n.time DESC LIMIT ?
      `).bind(childId, fromDate, toDate, need).all<ActivityEntry>(),
      c.env.DB.prepare(`
        SELECT 'Medication' AS activity_type, m.id AS id, m.time AS event_time,
          m.name || CASE WHEN m.dosage IS NOT NULL THEN ' ' || m.dosage || COALESCE(' ' || m.dosage_unit, '') ELSE '' END AS detail,
          NULL AS end_time, NULL AS subtype, m.name AS label,
          m.dosage AS amount, m.dosage_unit AS amount_unit, NULL AS color,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM medications m
        JOIN children c ON c.id = m.child_id
        LEFT JOIN users u ON u.id = m.created_by_user_id
        WHERE m.child_id = ? AND m.time >= ? AND m.time <= ?
        ORDER BY m.time DESC LIMIT ?
      `).bind(childId, fromDate, toDate, need).all<ActivityEntry>(),
    ]);

  const all: ActivityEntry[] = [
    ...feedings.results,
    ...diapers.results,
    ...sleepSessions.results,
    ...tummyTimes.results,
    ...pumping.results,
    ...temperatures.results,
    ...notes.results,
    ...medications.results,
  ];

  // Sort descending (most recent first) then paginate. `all` now holds at most
  // `need` rows per source rather than the whole history, but the page it
  // yields is identical: nothing dropped by the per-query limit could have
  // sorted above a row that survived it.
  all.sort((a, b) => b.event_time.localeCompare(a.event_time));
  const page = all.slice(offset, offset + limit);

  const counts = await Promise.all(countQueries);
  const total = counts.reduce((sum, row) => sum + (row?.n ?? 0), 0);

  return c.json({ total, offset, limit, results: page });
});

export { activity };
