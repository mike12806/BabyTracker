import { Hono } from "hono";
import type { Env } from "../types/env.js";
import { insertOnce, readClientRequestId } from "./idempotency.js";
import { announceChange } from "../live.js";
import { emit } from "../events/bus.js";
import { entryEvent } from "../events/types.js";
import { backgroundWrites } from "../kv/cache.js";

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

    // Deduplicated when the client sent a key, so a retried save — or a second
    // tap that beat the first request home — returns the original entry rather
    // than logging a second one.
    const { rowId } = await insertOnce({
      db: c.env.DB,
      userId,
      table,
      clientRequestId: readClientRequestId(body),
      insert: c.env.DB.prepare(
        `INSERT INTO ${table} (${insertCols.join(", ")}) VALUES (${placeholders})`
      ).bind(...values),
    });

    const created = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`)
      .bind(rowId)
      .first();

    // The key was claimed by a create whose row has since been deleted. The
    // create did happen, so this is not an error; there is simply nothing left
    // to hand back, and resurrecting the entry would undo a deliberate delete.
    if (!created) return c.json({ deleted: true });

    // Say what happened, once. Whatever should follow from a logged entry —
    // today, resolving the overdue reminder it answers — is a subscriber in
    // `events/subscribers.ts` rather than a call added here, which is the
    // point of the bus: this route no longer has to know reminders exist.
    //
    // Deliberately after the insert, and deliberately unable to fail it: an
    // alert left standing is a stale bell, not a lost entry. `emit` swallows
    // its own errors for that reason, and `waitUntil` keeps the publish off
    // the response path entirely.
    //
    // A deduplicated retry emits too, and harmlessly — every subscriber on
    // this bus is idempotent, which is what made a retried create safe here
    // long before the events did.
    await emit(
      c.env,
      entryEvent("entry.created", {
        childId,
        table,
        entryId: rowId,
        actorUserId: userId,
      }),
      backgroundWrites(c),
    );

    // Not on the bus, on purpose: the live nudge is the one piece of this
    // whose job is to feel instant, and a queue hop is latency. See bus.ts.
    await announceChange(c, childId);

    return c.json(created, 201);
  });

  // PUT /:id — update entry
  router.put("/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);

    const body = await c.req.json<Record<string, unknown>>();
    const updateCols = columns.filter((col) => body[col] !== undefined);

    if (updateCols.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    const setClauses = [
      ...updateCols.map((col) => `${col} = ?`),
      "updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
      "updated_by_user_id = ?",
    ];
    const values = [...updateCols.map((col) => body[col]), c.get("userId")];

    // One round trip: no row back means there was no entry to update.
    const updated = await c.env.DB.prepare(
      `UPDATE ${table} SET ${setClauses.join(", ")} WHERE id = ? RETURNING *`
    )
      .bind(...values, id)
      .first();

    if (!updated) {
      return c.json({ error: "Not found" }, 404);
    }

    // `updated.child_id`, not the body: an edit does not carry a child_id,
    // and the row's own child is who was watching it anyway.
    await emit(
      c.env,
      entryEvent("entry.updated", {
        childId: updated.child_id as number,
        table,
        entryId: id,
        actorUserId: c.get("userId"),
      }),
      backgroundWrites(c),
    );

    await announceChange(c, updated.child_id as number);

    return c.json(updated);
  });

  // DELETE /:id
  router.delete("/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);

    const existing = await c.env.DB.prepare(
      `DELETE FROM ${table} WHERE id = ? RETURNING child_id`
    )
      .bind(id)
      .first();

    if (!existing) {
      return c.json({ error: "Not found" }, 404);
    }

    // A delete is as much a change as a create — the other caregiver's list is
    // showing a row that is gone.
    //
    // Nothing subscribes to this one today. It is published anyway because the
    // alternative is a bus whose events exist only where someone happened to
    // need them, which is how a write path ends up being edited again the next
    // time something does.
    await emit(
      c.env,
      entryEvent("entry.deleted", {
        childId: existing.child_id as number,
        table,
        entryId: id,
        actorUserId: c.get("userId"),
      }),
      backgroundWrites(c),
    );

    await announceChange(c, existing.child_id as number);

    return c.json({ ok: true });
  });

  return router;
}
