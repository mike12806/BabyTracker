import { Hono } from "hono";
import type { Env } from "../types/env.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

const alerts = new Hono<AppEnv>();

/** Most recent alerts to hand back. The feed is a fortnight of context, not an archive. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Second-precision UTC, the format `alerts.created_at` is written in.
 *
 * The read mark is compared against those timestamps as a *string*, and the
 * two formats do not sort against each other: `"…T12:00:00.000Z"` is
 * lexicographically less than `"…T12:00:00Z"`, because `.` sorts below `Z`.
 * Storing a millisecond-precision mark would therefore leave the alert it was
 * taken from counting as unread forever, and the badge would never clear.
 */
function toSecondPrecision(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}

interface AlertRow {
  id: number;
  child_id: number;
  kind: string;
  title: string;
  body: string;
  url: string;
  created_at: string;
  child_first_name: string;
}

/**
 * GET /api/alerts — the alerts feed for this user, newest first.
 *
 * Scoped through `user_children` like every other read here: an alert names a
 * child, so it is only visible to the people linked to that child.
 *
 * `unread` counts against `alert_reads.last_read_at` rather than a per-alert
 * read flag — the bell only needs "how many since you last looked". With no
 * row yet (nobody has opened the drawer on this account), everything in the
 * window counts as unread, which is the honest answer.
 *
 * The bell refetches this on every foreground poll, so it is on the app's
 * hot path. It stays cheap by construction rather than by caching: `alerts`
 * is pruned to 30 days (a few dozen rows), the list is capped, and the count
 * is the only unbounded read here. Nothing to worry about against the five
 * `limit=500` queries a Dashboard refresh already makes — but it is the
 * reason this table is pruned rather than kept forever.
 */
alerts.get("/", async (c) => {
  const userId = c.get("userId");
  const limit = Math.min(parseInt(c.req.query("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, MAX_LIMIT);

  const read = await c.env.DB.prepare("SELECT last_read_at FROM alert_reads WHERE user_id = ?")
    .bind(userId)
    .first<{ last_read_at: string }>();
  const lastReadAt = read?.last_read_at ?? null;

  const [list, unread] = await Promise.all([
    c.env.DB.prepare(
      `SELECT a.id, a.child_id, a.kind, a.title, a.body, a.url, a.created_at,
              c.first_name AS child_first_name
         FROM alerts a
         JOIN children c ON c.id = a.child_id
         JOIN user_children uc ON uc.child_id = a.child_id
        WHERE uc.user_id = ?
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ?`,
    )
      .bind(userId, limit)
      .all<AlertRow>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n
         FROM alerts a
         JOIN user_children uc ON uc.child_id = a.child_id
        WHERE uc.user_id = ? AND (? IS NULL OR a.created_at > ?)`,
    )
      .bind(userId, lastReadAt, lastReadAt)
      .first<{ n: number }>(),
  ]);

  return c.json({
    alerts: list.results,
    unread: unread?.n ?? 0,
    last_read_at: lastReadAt,
  });
});

/**
 * POST /api/alerts/read — mark the feed read up to a point in time.
 *
 * The client sends the timestamp of the newest alert it actually rendered
 * rather than letting the server take "now": an alert raised in the seconds
 * between the fetch and the tap would otherwise be marked read without ever
 * having been on screen. Falls back to now when the body is empty (an empty
 * feed has no newest row to name).
 *
 * Only ever moves forward. A second device opening a stale drawer would
 * otherwise reset the badge backwards and re-raise alerts already read here.
 */
alerts.post("/read", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ up_to?: string }>().catch(() => ({}) as { up_to?: string });

  const upTo = body.up_to && !Number.isNaN(Date.parse(body.up_to))
    ? toSecondPrecision(body.up_to)
    : toSecondPrecision(new Date().toISOString());

  await c.env.DB.prepare(
    `INSERT INTO alert_reads (user_id, last_read_at) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE
        SET last_read_at = MAX(alert_reads.last_read_at, excluded.last_read_at),
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
  )
    .bind(userId, upTo)
    .run();

  const row = await c.env.DB.prepare("SELECT last_read_at FROM alert_reads WHERE user_id = ?")
    .bind(userId)
    .first<{ last_read_at: string }>();

  return c.json({ ok: true, last_read_at: row?.last_read_at ?? upTo });
});

export { alerts };
