import { Hono } from "hono";
import type { Env } from "../types/env.js";
import { verifyChildAccess } from "./crud.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

const timers = new Hono<AppEnv>();

// GET /api/timers — list active timers for the user
timers.get("/", async (c) => {
  const userId = c.get("userId");
  const childId = c.req.query("child_id");

  let sql = `SELECT t.* FROM timers t JOIN user_children uc ON t.child_id = uc.child_id WHERE uc.user_id = ?`;
  const params: unknown[] = [userId];

  if (childId) {
    sql += " AND t.child_id = ?";
    params.push(parseInt(childId, 10));
  }

  const activeOnly = c.req.query("active");
  if (activeOnly === "true") {
    sql += " AND t.is_active = 1";
  }

  sql += " ORDER BY t.start_time DESC";

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

  if (!(await verifyChildAccess(c.env.DB, userId, body.child_id))) {
    return c.json({ error: "Child not found" }, 404);
  }

  const result = await c.env.DB.prepare(
    "INSERT INTO timers (child_id, user_id, name, start_time, notes) VALUES (?, ?, ?, datetime('now'), ?)"
  )
    .bind(body.child_id, userId, body.name, body.notes || null)
    .run();

  const timer = await c.env.DB.prepare("SELECT * FROM timers WHERE id = ?")
    .bind(result.meta.last_row_id)
    .first();

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
    "UPDATE timers SET end_time = datetime('now'), is_active = 0, updated_at = datetime('now') WHERE id = ?"
  )
    .bind(id)
    .run();

  const timer = await c.env.DB.prepare("SELECT * FROM timers WHERE id = ?")
    .bind(id)
    .first();

  return c.json(timer);
});

// DELETE /api/timers/:id
timers.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = parseInt(c.req.param("id"), 10);

  const existing = await c.env.DB.prepare(
    "SELECT 1 FROM timers WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .first();

  if (!existing) {
    return c.json({ error: "Timer not found" }, 404);
  }

  await c.env.DB.prepare("DELETE FROM timers WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

export { timers };
