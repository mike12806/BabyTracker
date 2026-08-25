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
import { enqueueDailyNotes, writeNoteForJob, DAILY_NOTE_QUEUE } from "./scheduled/dailyNote.js";
import type { DailyNoteJob } from "./scheduled/dailyNote.js";
import { enqueueBoopLineRefresh, refreshMood, BOOP_LINES_QUEUE } from "./scheduled/boopLines.js";
import type { BoopLineJob } from "./scheduled/boopLines.js";
import { enqueueReminderChecks, deliverReminder, REMINDER_QUEUE } from "./scheduled/reminders.js";
import type { ReminderJob } from "./scheduled/reminders.js";
import {
  runFeedingTrendCron,
  deliverFeedingTrendAlert,
  FEEDING_TREND_QUEUE,
} from "./scheduled/feedingTrend.js";
import type { FeedingTrendJob } from "./scheduled/feedingTrend.js";
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
import { dailyNotes } from "./routes/dailyNotes.js";
import { boopLines } from "./routes/boopLines.js";
import { push } from "./routes/push.js";
import { feedingTrend } from "./routes/feedingTrend.js";

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
app.route("/api/daily-notes", dailyNotes);
app.route("/api/boop-lines", boopLines);
app.route("/api/push", push);
app.route("/api/feeding-trend", feedingTrend);

// Global error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

/**
 * The note cron, exactly as it appears in `wrangler.toml`. The email cron
 * fires 15 minutes later so the note (queued here) has landed in
 * `child_daily_notes` before the summary reads it — anything else that
 * fires `scheduled()` is treated as the email cron, except BOOP_LINES_CRON
 * below.
 */
const NOTE_CRON = "0 5 * * *";

/**
 * The boop-line cron — see scheduled/boopLines.ts.
 *
 * Weekly, not daily: the daily note has to be daily because it describes
 * yesterday, but there's no equivalent reason for the boop pool to turn over
 * that often — a handful of new lines a week is already more variety than
 * anyone taps through. Off-hour and off the other two crons' minute so it
 * never competes with them for the same invocation.
 */
const BOOP_LINES_CRON = "30 4 * * SUN";

/**
 * The reminder cron — see scheduled/reminders.ts. The only sub-daily cron
 * here, since checking a 2h45m gap needs far more frequent checking than
 * anything else in this Worker.
 */
const REMINDERS_CRON = "*/5 * * * *";

/**
 * The feeding-trend cron — see scheduled/feedingTrend.ts.
 *
 * The checkpoints wanted are 11am, 4pm and 7pm *Eastern*, and cron here is
 * UTC, so a fixed three-hour list would drift by an hour twice a year. This
 * fires at six UTC hours instead — the EDT and the EST translation of each
 * checkpoint — and `runFeedingTrendCron` keeps only the three invocations
 * that actually land on an ET checkpoint hour, discarding the other three:
 *
 *   UTC 15 → 11am EDT ✓ / 10am EST ✗
 *   UTC 16 → 12pm EDT ✗ / 11am EST ✓
 *   UTC 20 →  4pm EDT ✓ /  3pm EST ✗
 *   UTC 21 →  5pm EDT ✗ /  4pm EST ✓
 *   UTC 23 →  7pm EDT ✓ /  6pm EST ✗
 *   UTC 00 →  8pm EDT ✗ /  7pm EST ✓
 *
 * So exactly three checks a day happen year-round, on the right local clock,
 * with no DST-aware cron and no drift. The 00:00 UTC entry is 7pm ET on the
 * *previous* ET day, which is the day it is meant to be reporting on — every
 * window is derived from the ET calendar date of the instant, so that works
 * out on its own.
 */
const FEEDING_TREND_CRON = "0 15,16,20,21,23,0 * * *";

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === REMINDERS_CRON) {
      // Decides which (child, kind) gaps are overdue and enqueues one job per
      // subscribed device; the actual push send happens in the consumer
      // below, same split as the other crons.
      ctx.waitUntil(
        enqueueReminderChecks(env).catch((err) =>
          console.error("Reminder check failed:", err)
        )
      );
      return;
    }

    if (event.cron === FEEDING_TREND_CRON) {
      // Three of the six firings are thrown away inside — see the comment on
      // FEEDING_TREND_CRON. Unlike the crons below, the analysis itself runs
      // here rather than on the queue: the alert is about the day it is still
      // in, so a retried model call is worth less than the template sentence
      // it would have delayed. The queue only carries the finished push.
      ctx.waitUntil(
        runFeedingTrendCron(env).catch((err) =>
          console.error("Feeding trend check failed:", err)
        )
      );
      return;
    }

    if (event.cron === NOTE_CRON) {
      // Only writes each child's template note and queues the model call here;
      // the generation itself happens in the consumer below, where a transient
      // failure gets retried instead of costing that child their note for the
      // day.
      ctx.waitUntil(
        enqueueDailyNotes(env).catch((err) =>
          console.error("Daily note enqueue failed:", err)
        )
      );
      return;
    }

    if (event.cron === BOOP_LINES_CRON) {
      // Queues one refresh job per mood; the actual generation happens in
      // the consumer below, same split as the daily note above.
      ctx.waitUntil(
        enqueueBoopLineRefresh(env).catch((err) =>
          console.error("Boop line enqueue failed:", err)
        )
      );
      return;
    }

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
  async queue(
    batch: MessageBatch<DailySummaryJob | DailyNoteJob | BoopLineJob | ReminderJob | FeedingTrendJob>,
    env: Env,
  ): Promise<void> {
    if (batch.queue === FEEDING_TREND_QUEUE) {
      for (const message of batch.messages) {
        const job = message.body as FeedingTrendJob;
        try {
          await deliverFeedingTrendAlert(env, job);
          message.ack();
        } catch (err) {
          console.error(
            `Feeding trend alert delivery failed for subscription ${job?.subscriptionId}:`,
            err,
          );
          message.retry();
        }
      }
      return;
    }

    if (batch.queue === REMINDER_QUEUE) {
      for (const message of batch.messages) {
        const job = message.body as ReminderJob;
        try {
          await deliverReminder(env, job);
          message.ack();
        } catch (err) {
          console.error(`Reminder delivery failed for subscription ${job?.subscriptionId}:`, err);
          message.retry();
        }
      }
      return;
    }

    // Generating one child's note. A failure here is retried rather than
    // dropped — the template note is already on the card, so a retry is an
    // upgrade that can afford to be late, and there is no dead letter queue
    // behind it because the row already records that the model didn't answer.
    if (batch.queue === DAILY_NOTE_QUEUE) {
      for (const message of batch.messages) {
        const job = message.body as DailyNoteJob;
        try {
          const note = await writeNoteForJob(env, job);
          // A template note means the model declined; retry rather than ack,
          // since "out of capacity" is exactly the transient case this queue
          // exists for. `writeNoteForJob` has already logged the reason.
          if (note.source === "ai") message.ack();
          else message.retry();
        } catch (err) {
          console.error(`Daily note generation failed for child ${job?.childId}:`, err);
          message.retry();
        }
      }
      return;
    }

    if (batch.queue === BOOP_LINES_QUEUE) {
      for (const message of batch.messages) {
        const job = message.body as BoopLineJob;
        try {
          const { added, reason } = await refreshMood(env, job.mood);
          // Zero new lines usually means a transient model failure (out of
          // capacity, a bad reply) — retry, same as the daily note queue.
          // `refreshMood` has already logged the reason.
          if (added > 0 || !reason) message.ack();
          else message.retry();
        } catch (err) {
          console.error(`Boop line generation failed for "${job?.mood}":`, err);
          message.retry();
        }
      }
      return;
    }

    if (batch.queue === DAILY_SUMMARY_DLQ) {
      for (const message of batch.messages) {
        try {
          await alertDeadLetteredSummary(env, message.body as DailySummaryJob, message.attempts);
          message.ack();
        } catch (err) {
          // The alert goes over the same channel that just failed, so this is
          // a plausible outcome rather than a surprise. Retrying is still
          // right — most failures are transient — and there is no queue behind
          // this one, so a message that exhausts its attempts is discarded and
          // the log line below is the last word on it.
          console.error(
            `Could not report the dead-lettered summary for ${(message.body as DailySummaryJob)?.email}:`,
            err,
          );
          message.retry();
        }
      }
      return;
    }

    for (const message of batch.messages) {
      try {
        await deliverDailySummary(env, message.body as DailySummaryJob);
        message.ack();
      } catch (err) {
        // Retried `max_retries` times, then dead-lettered — and the branch
        // above turns that into an email rather than a message nobody sees.
        console.error(`Daily summary delivery failed for ${(message.body as DailySummaryJob)?.email}:`, err);
        message.retry();
      }
    }
  },
};
