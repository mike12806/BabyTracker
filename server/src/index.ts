import { Hono } from "hono";
import type { Env } from "./types/env.js";
import { authMiddleware } from "./middleware/auth.js";
import { cacheControlMiddleware } from "./middleware/cacheControl.js";
import {
  alertDeadLetteredSummary,
  deliverDailySummary,
  sendDailySummary,
  DAILY_SUMMARY_DLQ,
} from "./scheduled/dailySummary.js";
import type { DailySummaryJob } from "./scheduled/dailySummary.js";
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
import { medications } from "./routes/medications.js";
import { activity } from "./routes/activity.js";
import { todos } from "./routes/todos.js";

type AppEnv = { Bindings: Env; Variables: { userId: number; userEmail: string; userName: string } };

const app = new Hono<AppEnv>();

// All API routes require Cloudflare Access authentication
app.use("/api/*", authMiddleware);

// No intermediary may hand back a stale copy of a reply — see the middleware.
app.use("/api/*", cacheControlMiddleware);

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
app.route("/api/medications", medications);
app.route("/api/activity", activity);
app.route("/api/todos", todos);

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

  /**
   * Deliver queued daily summaries, and report the ones that were given up on.
   *
   * One handler serves both consumers, so the batch is routed by queue name.
   *
   * Acked and retried per message rather than per batch: a batch-level retry
   * would redeliver the reports that already went out alongside the one that
   * failed, and a duplicate summary in someone's inbox is the failure this is
   * meant to avoid creating.
   */
  async queue(batch: MessageBatch<DailySummaryJob>, env: Env): Promise<void> {
    if (batch.queue === DAILY_SUMMARY_DLQ) {
      for (const message of batch.messages) {
        try {
          await alertDeadLetteredSummary(env, message.body, message.attempts);
          message.ack();
        } catch (err) {
          // The alert goes over the same channel that just failed, so this is
          // a plausible outcome rather than a surprise. Retrying is still
          // right — most failures are transient — and there is no queue behind
          // this one, so a message that exhausts its attempts is discarded and
          // the log line below is the last word on it.
          console.error(
            `Could not report the dead-lettered summary for ${message.body?.email}:`,
            err,
          );
          message.retry();
        }
      }
      return;
    }

    for (const message of batch.messages) {
      try {
        await deliverDailySummary(env, message.body);
        message.ack();
      } catch (err) {
        // Retried `max_retries` times, then dead-lettered — and the branch
        // above turns that into an email rather than a message nobody sees.
        console.error(`Daily summary delivery failed for ${message.body?.email}:`, err);
        message.retry();
      }
    }
  },
};
