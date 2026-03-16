import { Hono } from "hono";
import type { Env } from "./types/env.js";
import { authMiddleware } from "./middleware/auth.js";
import { sendDailySummary } from "./scheduled/dailySummary.js";
import { auth } from "./routes/auth.js";
import { children } from "./routes/children.js";
import { feedings } from "./routes/feedings.js";
import { diaperChanges } from "./routes/diaperChanges.js";
import { sleep } from "./routes/sleep.js";
import { tummyTime } from "./routes/tummyTime.js";
import { pumping } from "./routes/pumping.js";
import { growth } from "./routes/growth.js";
import { temperature } from "./routes/temperature.js";
import { notes } from "./routes/notes.js";
import { timers } from "./routes/timers.js";
import { settings } from "./routes/settings.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

const app = new Hono<AppEnv>();

// All API routes require Cloudflare Access authentication
app.use("/api/*", authMiddleware);

// Auth routes (user identity from CF Access JWT)
app.route("/api/auth", auth);

// Resource routes
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

// Global error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      sendDailySummary(env).catch((err) =>
        console.error("Daily summary failed:", err)
      )
    );
  },
};
