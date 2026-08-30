import { Hono } from "hono";
import type { Env } from "../types/env.js";
import { verifyChildExists } from "./crud.js";
import { announceChange } from "../live.js";
import { insertOnce, readClientRequestId } from "./idempotency.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

const timers = new Hono<AppEnv>();

// GET /api/timers — list timers for a child
timers.get("/", async (c) => {
  const childId = c.req.query("child_id");

  let sql = `SELECT * FROM timers WHERE 1=1`;
  const params: unknown[] = [];

  if (childId) {
    sql += " AND child_id = ?";
    params.push(parseInt(childId, 10));
  }

  const activeOnly = c.req.query("active");
  if (activeOnly === "true") {
    sql += " AND is_active = 1";
  }

  sql += " ORDER BY start_time DESC";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(results);
});

// POST /api/timers — start a new timer
timers.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ child_id: number; name: string; notes?: string }>();

  if (!body.child_id || !body.name) {
    return c.json({ error: "child_id and name are required" }, 400);
  }

  if (!(await verifyChildExists(c.env.DB, body.child_id))) {
    return c.json({ error: "Child not found" }, 404);
  }

  const { rowId } = await insertOnce({
    db: c.env.DB,
    userId,
    table: "timers",
    clientRequestId: readClientRequestId(body as unknown as Record<string, unknown>),
    insert: c.env.DB.prepare(
      "INSERT INTO timers (child_id, user_id, name, start_time, notes) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), ?)"
    ).bind(body.child_id, userId, body.name, body.notes || null),
  });

  const timer = await c.env.DB.prepare("SELECT * FROM timers WHERE id = ?")
    .bind(rowId)
    .first();

  if (!timer) return c.json({ deleted: true });

  // A running timer is the one thing here that is *only* true while it runs,
  // so the other phone showing "no timer" is wrong the moment this returns.
  await announceChange(c, body.child_id, "timers");

  return c.json(timer, 201);
});

// PUT /api/timers/:id/stop — stop a timer
timers.put("/:id/stop", async (c) => {
  const userId = c.get("userId");
  const id = parseInt(c.req.param("id"), 10);

  const existing = await c.env.DB.prepare(
    "SELECT t.* FROM timers t WHERE t.id = ? AND t.user_id = ?"
  )
    .bind(id, userId)
    .first();

  if (!existing) {
    return c.json({ error: "Timer not found" }, 404);
  }

  await c.env.DB.prepare(
    "UPDATE timers SET end_time = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"
  )
    .bind(id)
    .run();

  const timer = await c.env.DB.prepare("SELECT * FROM timers WHERE id = ?")
    .bind(id)
    .first();

  await announceChange(c, existing.child_id as number, "timers");

  return c.json(timer);
});

// DELETE /api/timers/:id
timers.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = parseInt(c.req.param("id"), 10);

  // `child_id` rather than `1`: the row is about to be gone, and it is the
  // only place left that says whose timer list needs refreshing.
  const existing = await c.env.DB.prepare(
    "SELECT child_id FROM timers WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .first();

  if (!existing) {
    return c.json({ error: "Timer not found" }, 404);
  }

  await c.env.DB.prepare("DELETE FROM timers WHERE id = ?").bind(id).run();

  await announceChange(c, existing.child_id as number, "timers");

  return c.json({ ok: true });
});

export { timers };
