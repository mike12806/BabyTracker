import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "../src/types/env.js";
import { auth } from "../src/routes/auth.js";
import { children } from "../src/routes/children.js";
import { feedings } from "../src/routes/feedings.js";
import { diaperChanges } from "../src/routes/diaperChanges.js";
import { sleep } from "../src/routes/sleep.js";
import { tummyTime } from "../src/routes/tummyTime.js";
import { pumping } from "../src/routes/pumping.js";
import { growth } from "../src/routes/growth.js";
import { temperature } from "../src/routes/temperature.js";
import { notes } from "../src/routes/notes.js";
import { timers } from "../src/routes/timers.js";
import { settings } from "../src/routes/settings.js";
import type { MiddlewareHandler } from "hono";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

/**
 * Auth middleware for tests — bypasses JWT verification.
 * Upserts a test user and sets context variables, same as the real middleware
 * but without needing real CF Access JWTs.
 */
const testAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const email = c.req.header("X-Test-Email") || "test@example.com";
  const name = c.req.header("X-Test-Name") || "Test User";

  await c.env.DB.prepare(
    "INSERT INTO users (email, name, created_at, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) ON CONFLICT(email) DO UPDATE SET name = excluded.name, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"
  )
    .bind(email, name)
    .run();

  const user = await c.env.DB.prepare("SELECT id, email, name FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: number; email: string; name: string }>();

  if (!user) {
    return c.json({ error: "Failed to resolve user" }, 500);
  }

  c.set("userId", user.id);
  c.set("userEmail", user.email);
  c.set("userName", user.name);

  await next();
};

/** Create a test app with the same routes as production but using a test auth middleware. */
export function createTestApp() {
  const app = new Hono<AppEnv>();

  app.use("/api/*", testAuthMiddleware);

  app.route("/api/auth", auth);
  app.route("/api/children", children);
  app.route("/api/feedings", feedings);
  app.route("/api/diaper-changes", diaperChanges);
  app.route("/api/sleep", sleep);
  app.route("/api/tummy-time", tummyTime);
  app.route("/api/pumping", pumping);
  app.route("/api/growth", growth);
  app.route("/api/temperature", temperature);
  app.route("/api/notes", notes);
  app.route("/api/timers", timers);
  app.route("/api/settings", settings);

  return app;
}

/** Run the migration SQL against a D1 database for test setup. Drops and recreates all tables. */
export async function applyMigrations(db: D1Database) {
  // Drop all tables first to ensure clean state between tests
  const dropSQL = `
    DROP TABLE IF EXISTS user_settings;
    DROP TABLE IF EXISTS timers;
    DROP TABLE IF EXISTS notes;
    DROP TABLE IF EXISTS temperature;
    DROP TABLE IF EXISTS growth;
    DROP TABLE IF EXISTS pumping;
    DROP TABLE IF EXISTS tummy_time;
    DROP TABLE IF EXISTS sleep;
    DROP TABLE IF EXISTS diaper_changes;
    DROP TABLE IF EXISTS feedings;
    DROP TABLE IF EXISTS user_children;
    DROP TABLE IF EXISTS children;
    DROP TABLE IF EXISTS users;
  `;

  const migrationSQL = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS children (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL DEFAULT '',
      birth_date TEXT NOT NULL,
      picture_url TEXT,
      picture_content_type TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS user_children (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      PRIMARY KEY (user_id, child_id)
    );

    CREATE TABLE IF NOT EXISTS feedings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('breast_left', 'breast_right', 'both_breasts', 'bottle', 'solid', 'fortified_breast_milk')),
      start_time TEXT NOT NULL,
      end_time TEXT,
      amount REAL,
      amount_unit TEXT CHECK(amount_unit IN ('ml', 'oz', 'g')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS diaper_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      time TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('wet', 'solid', 'both')),
      color TEXT CHECK(color IN ('black', 'brown', 'green', 'yellow', 'white', '')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS sleep (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      start_time TEXT NOT NULL,
      end_time TEXT,
      is_nap INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS tummy_time (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      start_time TEXT NOT NULL,
      end_time TEXT,
      milestone TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS pumping (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      start_time TEXT NOT NULL,
      end_time TEXT,
      amount REAL,
      amount_unit TEXT CHECK(amount_unit IN ('ml', 'oz')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS growth (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      weight REAL,
      weight_unit TEXT CHECK(weight_unit IN ('kg', 'lb', 'oz', 'g')),
      height REAL,
      height_unit TEXT CHECK(height_unit IN ('cm', 'in')),
      head_circumference REAL,
      head_circumference_unit TEXT CHECK(head_circumference_unit IN ('cm', 'in')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS temperature (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      time TEXT NOT NULL,
      reading REAL NOT NULL,
      reading_unit TEXT NOT NULL CHECK(reading_unit IN ('F', 'C')) DEFAULT 'F',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      time TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS timers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      default_child_id INTEGER REFERENCES children(id) ON DELETE SET NULL,
      theme_mode TEXT NOT NULL DEFAULT 'system' CHECK(theme_mode IN ('system', 'light', 'dark')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
  `;

  // D1 batch doesn't support multi-statement, so split and execute individually
  const allSQL = dropSQL + migrationSQL;
  const statements = allSQL
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const sql of statements) {
    await db.prepare(sql).run();
  }
}

/** Helper to make requests to the test app */
export function testRequest(app: ReturnType<typeof createTestApp>, db: D1Database, photos?: R2Bucket) {
  const env = {
    DB: db,
    PHOTOS: photos as R2Bucket,
    CF_ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-aud",
  };

  return {
    get: (path: string, headers?: Record<string, string>) =>
      app.request(path, { method: "GET", headers }, env),
    post: (path: string, body: unknown, headers?: Record<string, string>) =>
      app.request(
        path,
        {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json", ...headers },
        },
        env
      ),
    postForm: (path: string, formData: FormData, headers?: Record<string, string>) =>
      app.request(
        path,
        {
          method: "POST",
          body: formData,
          headers: { ...headers },
        },
        env
      ),
    put: (path: string, body: unknown, headers?: Record<string, string>) =>
      app.request(
        path,
        {
          method: "PUT",
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json", ...headers },
        },
        env
      ),
    delete: (path: string, headers?: Record<string, string>) =>
      app.request(path, { method: "DELETE", headers }, env),
  };
}
