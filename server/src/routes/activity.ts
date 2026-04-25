import { Hono } from "hono";
import type { Env } from "../types/env.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

interface ActivityEntry {
  activity_type: string;
  event_time: string;
  detail: string;
  child_name: string;
  logged_by: string;
}

const childNameExpr = `TRIM(c.first_name || CASE WHEN c.last_name IS NOT NULL AND c.last_name != '' THEN ' ' || c.last_name ELSE '' END)`;
const loggedByExpr = `COALESCE(u.name, u.email, 'Unknown')`;

const activity = new Hono<AppEnv>();

// GET /api/activity?child_id=X&limit=Y&offset=Z
// Returns a merged, reverse-chronological activity feed for the given child.
activity.get("/", async (c) => {
  const userId = c.get("userId");
  const childId = parseInt(c.req.query("child_id") || "0", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 200);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const dateFrom = c.req.query("date_from") || null;
  const dateTo = c.req.query("date_to") || null;

  if (!childId) {
    return c.json({ error: "child_id is required" }, 400);
  }

  // Verify the logged-in user has access to this child
  const access = await c.env.DB.prepare(
    "SELECT 1 FROM user_children WHERE user_id = ? AND child_id = ?"
  )
    .bind(userId, childId)
    .first();

  if (!access) {
    return c.json({ error: "Child not found" }, 404);
  }

  // Validate and normalize date filter values; use open-ended defaults if not provided.
  const fromDate = dateFrom && !isNaN(Date.parse(dateFrom)) ? dateFrom : "0000-01-01T00:00:00.000Z";
  const toDate = dateTo && !isNaN(Date.parse(dateTo)) ? dateTo : "9999-12-31T23:59:59.999Z";

  const [feedings, diapers, sleepSessions, tummyTimes, pumping, temperatures, notes, medications] =
    await Promise.all([
      c.env.DB.prepare(`
        SELECT 'Feeding' AS activity_type, f.start_time AS event_time,
          REPLACE(f.type, '_', ' ') AS detail,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM feedings f
        JOIN children c ON c.id = f.child_id
        LEFT JOIN users u ON u.id = f.created_by_user_id
        WHERE f.child_id = ? AND f.start_time >= ? AND f.start_time <= ?
      `).bind(childId, fromDate, toDate).all<ActivityEntry>(),
      c.env.DB.prepare(`
        SELECT 'Diaper Change' AS activity_type, d.time AS event_time,
          d.type || CASE WHEN d.color IS NOT NULL AND d.color != '' THEN ' (' || d.color || ')' ELSE '' END AS detail,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM diaper_changes d
        JOIN children c ON c.id = d.child_id
        LEFT JOIN users u ON u.id = d.created_by_user_id
        WHERE d.child_id = ? AND d.time >= ? AND d.time <= ?
      `).bind(childId, fromDate, toDate).all<ActivityEntry>(),
      c.env.DB.prepare(`
        SELECT 'Sleep' AS activity_type, s.start_time AS event_time,
          CASE WHEN s.is_nap = 1 THEN 'nap' ELSE 'night sleep' END AS detail,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM sleep s
        JOIN children c ON c.id = s.child_id
        LEFT JOIN users u ON u.id = s.created_by_user_id
        WHERE s.child_id = ? AND s.start_time >= ? AND s.start_time <= ?
      `).bind(childId, fromDate, toDate).all<ActivityEntry>(),
      c.env.DB.prepare(`
        SELECT 'Tummy Time' AS activity_type, t.start_time AS event_time,
          CASE WHEN t.milestone IS NOT NULL AND t.milestone != '' THEN 'tummy time — ' || t.milestone ELSE 'tummy time' END AS detail,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM tummy_time t
        JOIN children c ON c.id = t.child_id
        LEFT JOIN users u ON u.id = t.created_by_user_id
        WHERE t.child_id = ? AND t.start_time >= ? AND t.start_time <= ?
      `).bind(childId, fromDate, toDate).all<ActivityEntry>(),
      c.env.DB.prepare(`
        SELECT 'Pumping' AS activity_type, p.start_time AS event_time,
          CASE WHEN p.amount IS NOT NULL THEN 'pumped ' || p.amount || ' ' || COALESCE(p.amount_unit, '') ELSE 'pumping' END AS detail,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM pumping p
        JOIN children c ON c.id = p.child_id
        LEFT JOIN users u ON u.id = p.created_by_user_id
        WHERE p.child_id = ? AND p.start_time >= ? AND p.start_time <= ?
      `).bind(childId, fromDate, toDate).all<ActivityEntry>(),
      c.env.DB.prepare(`
        SELECT 'Temperature' AS activity_type, t.time AS event_time,
          t.reading || '°' || t.reading_unit AS detail,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM temperature t
        JOIN children c ON c.id = t.child_id
        LEFT JOIN users u ON u.id = t.created_by_user_id
        WHERE t.child_id = ? AND t.time >= ? AND t.time <= ?
      `).bind(childId, fromDate, toDate).all<ActivityEntry>(),
      c.env.DB.prepare(`
        SELECT 'Note' AS activity_type, n.time AS event_time,
          COALESCE(n.title, SUBSTR(n.content, 1, 60)) AS detail,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM notes n
        JOIN children c ON c.id = n.child_id
        LEFT JOIN users u ON u.id = n.created_by_user_id
        WHERE n.child_id = ? AND n.time >= ? AND n.time <= ?
      `).bind(childId, fromDate, toDate).all<ActivityEntry>(),
      c.env.DB.prepare(`
        SELECT 'Medication' AS activity_type, m.time AS event_time,
          m.name || CASE WHEN m.dosage IS NOT NULL THEN ' ' || m.dosage || COALESCE(' ' || m.dosage_unit, '') ELSE '' END AS detail,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM medications m
        JOIN children c ON c.id = m.child_id
        LEFT JOIN users u ON u.id = m.created_by_user_id
        WHERE m.child_id = ? AND m.time >= ? AND m.time <= ?
      `).bind(childId, fromDate, toDate).all<ActivityEntry>(),
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

  // Sort descending (most recent first) then paginate
  all.sort((a, b) => b.event_time.localeCompare(a.event_time));
  const total = all.length;
  const page = all.slice(offset, offset + limit);

  return c.json({ total, offset, limit, results: page });
});

export { activity };
