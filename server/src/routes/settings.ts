import { Hono } from "hono";
import type { Env } from "../types/env.js";

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
    "SELECT user_id, default_child_id, theme_mode FROM user_settings WHERE user_id = ?"
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
  }>();

  // Validate default_child_id belongs to this user if provided
  if (body.default_child_id != null) {
    const access = await c.env.DB.prepare(
      "SELECT 1 FROM user_children WHERE user_id = ? AND child_id = ?"
    )
      .bind(userId, body.default_child_id)
      .first();

    if (!access) {
      return c.json({ error: "Child not found" }, 404);
    }
  }

  // Validate theme_mode
  if (body.theme_mode && !["system", "light", "dark"].includes(body.theme_mode)) {
    return c.json({ error: "Invalid theme_mode" }, 400);
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

  if (setClauses.length === 0) {
    // Nothing to update — just ensure row exists and return it
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)"
    )
      .bind(userId)
      .run();
  } else {
    setClauses.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");

    // Insert with provided values so first-time upsert gets the right data
    const insertDefault = body.default_child_id !== undefined ? (body.default_child_id ?? null) : null;
    const insertTheme = body.theme_mode ?? "system";

    await c.env.DB.prepare(
      `INSERT INTO user_settings (user_id, default_child_id, theme_mode) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET ${setClauses.join(", ")}`
    )
      .bind(userId, insertDefault, insertTheme, ...setValues)
      .run();
  }

  const row = await c.env.DB.prepare(
    "SELECT user_id, default_child_id, theme_mode FROM user_settings WHERE user_id = ?"
  )
    .bind(userId)
    .first();

  return c.json(row);
});

export { settings };
