import { Hono } from "hono";
import type { Env } from "../types/env.js";
import { verifyChildExists } from "./crud.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

const router = new Hono<AppEnv>();

router.get("/", async (c) => {
  const childId = parseInt(c.req.query("child_id") || "0", 10);
  if (!childId || !(await verifyChildExists(c.env.DB, childId))) {
    return c.json({ error: "Child not found" }, 404);
  }

  const limit = Math.min(parseInt(c.req.query("limit") || "200", 10), 500);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM todos WHERE child_id = ? ORDER BY completed ASC, due_date ASC NULLS LAST, created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(childId, limit, offset)
    .all();

  return c.json(results);
});

router.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const row = await c.env.DB.prepare("SELECT * FROM todos WHERE id = ?").bind(id).first();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

router.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const childId = body.child_id as number;

  if (!childId || !(await verifyChildExists(c.env.DB, childId))) {
    return c.json({ error: "Child not found" }, 404);
  }

  if (!body.title || (body.title as string).trim() === "") {
    return c.json({ error: "title is required" }, 400);
  }

  const userId = c.get("userId");
  const result = await c.env.DB.prepare(
    `INSERT INTO todos (child_id, created_by_user_id, title, notes, due_date, priority, completed)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  )
    .bind(
      childId,
      userId,
      (body.title as string).trim(),
      body.notes ?? null,
      body.due_date ?? null,
      body.priority ?? "medium",
    )
    .run();

  const created = await c.env.DB.prepare("SELECT * FROM todos WHERE id = ?")
    .bind(result.meta.last_row_id)
    .first();

  return c.json(created, 201);
});

router.put("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const existing = await c.env.DB.prepare("SELECT * FROM todos WHERE id = ?").bind(id).first();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<Record<string, unknown>>();

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.title !== undefined) {
    updates.push("title = ?");
    values.push((body.title as string).trim());
  }
  if (body.notes !== undefined) {
    updates.push("notes = ?");
    values.push(body.notes);
  }
  if (body.due_date !== undefined) {
    updates.push("due_date = ?");
    values.push(body.due_date);
  }
  if (body.priority !== undefined) {
    updates.push("priority = ?");
    values.push(body.priority);
  }
  if (body.completed !== undefined) {
    const done = body.completed ? 1 : 0;
    updates.push("completed = ?");
    values.push(done);
    updates.push("completed_at = ?");
    values.push(done ? new Date().toISOString() : null);
  }

  if (updates.length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");

  await c.env.DB.prepare(`UPDATE todos SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values, id)
    .run();

  const updated = await c.env.DB.prepare("SELECT * FROM todos WHERE id = ?").bind(id).first();
  return c.json(updated);
});

router.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const existing = await c.env.DB.prepare("SELECT * FROM todos WHERE id = ?").bind(id).first();
  if (!existing) return c.json({ error: "Not found" }, 404);
  await c.env.DB.prepare("DELETE FROM todos WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

export const todos = router;
