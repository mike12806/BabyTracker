/// <reference types="vite/client" />
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
import migration0001 from "../migrations/0001_initial_schema.sql?raw";
import migration0002 from "../migrations/0002_add_picture_blob.sql?raw";
import migration0003 from "../migrations/0003_add_user_settings.sql?raw";
import migration0004 from "../migrations/0004_add_email_reports.sql?raw";
import migration0005 from "../migrations/0005_add_medications.sql?raw";
import migration0006 from "../migrations/0006_add_created_by_user_id.sql?raw";

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
    DROP TABLE IF EXISTS medications;
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

  // Execute the real migration files in order to keep test schema in sync
  const migrations = [migration0001, migration0002, migration0003, migration0004, migration0005, migration0006];

  // D1 batch doesn't support multi-statement, so split and execute individually
  const allSQL = dropSQL + migrations.join("\n");
  const statements = allSQL
    .split(";")
    .map((s) => s.trim())
    .filter((s) => {
      // Skip empty strings and comment-only fragments
      const withoutComments = s.replace(/--[^\n]*/g, "").trim();
      return withoutComments.length > 0;
    });

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
