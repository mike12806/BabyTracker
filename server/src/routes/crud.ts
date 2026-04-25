import { Hono } from "hono";
import type { Env } from "../types/env.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

/** Verify the given child exists */
export async function verifyChildExists(db: D1Database, childId: number): Promise<boolean> {
  const row = await db.prepare(
    "SELECT 1 FROM children WHERE id = ?"
  )
    .bind(childId)
    .first();
  return !!row;
}

interface CrudRouteConfig {
  table: string;
  columns: string[];
  requiredColumns: string[];
  /** Column used for default ordering (descending). Defaults to "created_at". */
  orderBy?: string;
}

/**
 * Create a standard CRUD Hono router for a child-scoped tracking entity.
 * Routes: GET /, GET /:id, POST /, PUT /:id, DELETE /:id
 * All routes expect child_id as a query param (GET list) or in the body.
 */
export function createChildScopedCrud(config: CrudRouteConfig) {
  const { table, columns, requiredColumns, orderBy = "created_at" } = config;
  const router = new Hono<AppEnv>();

  // GET / — list entries, filtered by child_id query param
  router.get("/", async (c) => {
    const childId = parseInt(c.req.query("child_id") || "0", 10);

    if (!childId || !(await verifyChildExists(c.env.DB, childId))) {
      return c.json({ error: "Child not found" }, 404);
    }

    const limit = Math.min(parseInt(c.req.query("limit") || "100", 10), 500);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM ${table} WHERE child_id = ? ORDER BY ${orderBy} DESC LIMIT ? OFFSET ?`
    )
      .bind(childId, limit, offset)
      .all();

    return c.json(results);
  });

  // GET /:id — get single entry
  router.get("/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);

    const row = await c.env.DB.prepare(
      `SELECT * FROM ${table} WHERE id = ?`
    )
      .bind(id)
      .first();

    if (!row) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.json(row);
  });

  // POST / — create entry
  router.post("/", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const childId = body.child_id as number;

    if (!childId || !(await verifyChildExists(c.env.DB, childId))) {
      return c.json({ error: "Child not found" }, 404);
    }

    // Validate required fields
    for (const col of requiredColumns) {
      if (body[col] === undefined || body[col] === null || body[col] === "") {
        return c.json({ error: `${col} is required` }, 400);
      }
    }

    const userId = c.get("userId");
    const insertCols = ["child_id", "created_by_user_id", ...columns.filter((col) => body[col] !== undefined)];
    const placeholders = insertCols.map(() => "?").join(", ");
    const values = insertCols.map((col) => {
      if (col === "child_id") return childId;
      if (col === "created_by_user_id") return userId;
      return body[col];
    });

    const result = await c.env.DB.prepare(
      `INSERT INTO ${table} (${insertCols.join(", ")}) VALUES (${placeholders})`
    )
      .bind(...values)
      .run();

    const created = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`)
      .bind(result.meta.last_row_id)
      .first();

    return c.json(created, 201);
  });

  // PUT /:id — update entry
  router.put("/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);

    // Verify entry exists
    const existing = await c.env.DB.prepare(
      `SELECT child_id FROM ${table} WHERE id = ?`
    )
      .bind(id)
      .first();

    if (!existing) {
      return c.json({ error: "Not found" }, 404);
    }

    const body = await c.req.json<Record<string, unknown>>();
    const updateCols = columns.filter((col) => body[col] !== undefined);

    if (updateCols.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    const setClauses = [...updateCols.map((col) => `${col} = ?`), "updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"];
    const values = updateCols.map((col) => body[col]);

    await c.env.DB.prepare(
      `UPDATE ${table} SET ${setClauses.join(", ")} WHERE id = ?`
    )
      .bind(...values, id)
      .run();

    const updated = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`)
      .bind(id)
      .first();

    return c.json(updated);
  });

  // DELETE /:id
  router.delete("/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);

    const existing = await c.env.DB.prepare(
      `SELECT child_id FROM ${table} WHERE id = ?`
    )
      .bind(id)
      .first();

    if (!existing) {
      return c.json({ error: "Not found" }, 404);
    }

    await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();

    return c.json({ ok: true });
  });

  return router;
}
