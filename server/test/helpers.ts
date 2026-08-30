/// <reference types="vite/client" />
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "../src/types/env.js";
import { cacheControlMiddleware } from "../src/middleware/cacheControl.js";
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
import { medications } from "../src/routes/medications.js";
import { activity } from "../src/routes/activity.js";
import { todos } from "../src/routes/todos.js";
import { dailyNotes } from "../src/routes/dailyNotes.js";
import { boopLines } from "../src/routes/boopLines.js";
import { push } from "../src/routes/push.js";
import { feedingTrend } from "../src/routes/feedingTrend.js";
import { alerts } from "../src/routes/alerts.js";
import { live } from "../src/routes/live.js";
import type { MiddlewareHandler } from "hono";
import migration0001 from "../migrations/0001_initial_schema.sql?raw";
import migration0002 from "../migrations/0002_add_picture_blob.sql?raw";
import migration0003 from "../migrations/0003_add_user_settings.sql?raw";
import migration0004 from "../migrations/0004_add_email_reports.sql?raw";
import migration0005 from "../migrations/0005_add_medications.sql?raw";
import migration0006 from "../migrations/0006_add_created_by_user_id.sql?raw";
import migration0007 from "../migrations/0007_add_todos.sql?raw";
import migration0008 from "../migrations/0008_split_bottle_feeding_type.sql?raw";
import migration0009 from "../migrations/0009_add_pumping_side.sql?raw";
import migration0010 from "../migrations/0010_add_cc_feeding_unit.sql?raw";
import migration0011 from "../migrations/0011_add_volume_unit_setting.sql?raw";
import migration0012 from "../migrations/0012_add_clinic_weight_readings.sql?raw";
import migration0013 from "../migrations/0013_add_diaper_type_none.sql?raw";
import migration0014 from "../migrations/0014_add_client_requests.sql?raw";
import migration0015 from "../migrations/0015_add_daily_notes.sql?raw";
import migration0016 from "../migrations/0016_add_boop_lines.sql?raw";
import migration0017 from "../migrations/0017_add_push_subscriptions.sql?raw";
import migration0018 from "../migrations/0018_add_feeding_trend_checks.sql?raw";
import migration0019 from "../migrations/0019_add_alerts.sql?raw";
import migration0020 from "../migrations/0020_add_alert_dismissals.sql?raw";

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
  // Mounted between the middlewares exactly as in src/index.ts — a 101 that
  // went through `cacheControlMiddleware` would lose its socket, so the
  // ordering is part of what these tests are checking.
  app.route("/api/live", live);
  app.use("/api/*", cacheControlMiddleware);

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
  app.route("/api/medications", medications);
  app.route("/api/activity", activity);
  app.route("/api/todos", todos);
  app.route("/api/daily-notes", dailyNotes);
  app.route("/api/boop-lines", boopLines);
  app.route("/api/push", push);
  app.route("/api/feeding-trend", feedingTrend);
  app.route("/api/alerts", alerts);

  return app;
}

/** Run a multi-statement SQL script against D1, which only accepts one statement at a time. */
export async function execScript(db: D1Database, script: string) {
  const statements = script
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

/** Run the migration SQL against a D1 database for test setup. Drops and recreates all tables. */
export async function applyMigrations(db: D1Database) {
  // Drop all tables first to ensure clean state between tests
  const dropSQL = `
    DROP TABLE IF EXISTS alert_dismissals;
    DROP TABLE IF EXISTS alert_reads;
    DROP TABLE IF EXISTS alerts;
    DROP TABLE IF EXISTS feeding_trend_checks;
    DROP TABLE IF EXISTS reminder_state;
    DROP TABLE IF EXISTS push_subscriptions;
    DROP TABLE IF EXISTS boop_lines;
    DROP TABLE IF EXISTS child_daily_notes;
    DROP TABLE IF EXISTS client_requests;
    DROP TABLE IF EXISTS todos;
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
  const migrations = [migration0001, migration0002, migration0003, migration0004, migration0005, migration0006, migration0007, migration0008, migration0009, migration0010, migration0011, migration0012, migration0013, migration0014, migration0015, migration0016, migration0017, migration0018, migration0019, migration0020];

  await execScript(db, dropSQL + migrations.join("\n"));
}

/** Helper to make requests to the test app */
export function testRequest(
  app: ReturnType<typeof createTestApp>,
  db: D1Database,
  photos?: R2Bucket,
  extraEnv?: Partial<Env>,
) {
  // `LIVE` is deliberately absent unless a test asks for it. Every write path
  // announces its change, and `notifyChange` no-ops without the binding — so
  // the tests that are not about live updates neither pay for a Durable Object
  // round trip nor depend on one, which is the same thing production does when
  // the binding is missing.
  const env = {
    DB: db,
    PHOTOS: photos as R2Bucket,
    CF_ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-aud",
    ...extraEnv,
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
