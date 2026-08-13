import { Hono } from "hono";
import type { Env } from "../types/env.js";
import { verifyChildExists } from "./crud.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

const settings = new Hono<AppEnv>();

// GET /api/settings — return current user's settings (auto-creates if missing)
settings.get("/", async (c) => {
  const userId = c.get("userId");

  // Ensure a settings row exists
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)"
  )
    .bind(userId)
    .run();

  const row = await c.env.DB.prepare(
    "SELECT user_id, default_child_id, theme_mode, email_reports, volume_unit FROM user_settings WHERE user_id = ?"
  )
    .bind(userId)
    .first();

  return c.json(row);
});

// PUT /api/settings — update current user's settings
settings.put("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    default_child_id?: number | null;
    theme_mode?: "system" | "light" | "dark";
    email_reports?: boolean;
    volume_unit?: "ml" | "oz" | "cc";
  }>();

  // Validate the child exists if provided. Same reasoning as `/api/activity`:
  // requiring a `user_children` row here rejected a default child the user can
  // already see and select everywhere else in the app.
  if (body.default_child_id != null) {
    if (!(await verifyChildExists(c.env.DB, body.default_child_id))) {
      return c.json({ error: "Child not found" }, 404);
    }
  }

  // Validate theme_mode
  if (body.theme_mode && !["system", "light", "dark"].includes(body.theme_mode)) {
    return c.json({ error: "Invalid theme_mode" }, 400);
  }

  // Validate volume_unit — the column has the same CHECK, but a 400 beats a
  // constraint failure surfacing as a 500.
  if (body.volume_unit && !["ml", "oz", "cc"].includes(body.volume_unit)) {
    return c.json({ error: "Invalid volume_unit" }, 400);
  }

  // Upsert settings — build update clauses dynamically to distinguish "not provided" from "set to null"
  const setClauses: string[] = [];
  const setValues: (string | number | null)[] = [];

  if ("default_child_id" in body) {
    setClauses.push("default_child_id = ?");
    setValues.push(body.default_child_id ?? null);
  }
  if ("theme_mode" in body) {
    setClauses.push("theme_mode = ?");
    setValues.push(body.theme_mode!);
  }
  if ("email_reports" in body) {
    setClauses.push("email_reports = ?");
    setValues.push(body.email_reports ? 1 : 0);
  }
  if ("volume_unit" in body) {
    setClauses.push("volume_unit = ?");
    setValues.push(body.volume_unit!);
  }

  // Ensure the row exists (creates with column defaults on first visit)
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)"
  )
    .bind(userId)
    .run();

  if (setClauses.length > 0) {
    setClauses.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
    await c.env.DB.prepare(
      `UPDATE user_settings SET ${setClauses.join(", ")} WHERE user_id = ?`
    )
      .bind(...setValues, userId)
      .run();
  }

  const row = await c.env.DB.prepare(
    "SELECT user_id, default_child_id, theme_mode, email_reports, volume_unit FROM user_settings WHERE user_id = ?"
  )
    .bind(userId)
    .first();

  return c.json(row);
});

export { settings };
