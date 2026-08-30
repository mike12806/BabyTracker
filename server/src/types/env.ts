import type { DailySummaryJob } from "../scheduled/dailySummary.js";
import type { DailyNoteJob } from "../scheduled/dailyNote.js";
import type { BoopLineJob } from "../scheduled/boopLines.js";
import type { ReminderJob } from "../scheduled/reminders.js";
import type { FeedingTrendJob } from "../scheduled/feedingTrend.js";
import type { ChildLive } from "../live.js";

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  /**
   * Live-update fan-out, one Durable Object per child. See `src/live.ts`.
   *
   * Optional for the same reason the queues are: local dev without
   * `wrangler dev` and any test that does not care has no binding, and
   * `notifyChange` returns quietly rather than failing the write. The client
   * falls back to polling when the socket will not open, so an absent binding
   * costs latency, never correctness.
   */
  LIVE?: DurableObjectNamespace<ChildLive>;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  DEV_MODE?: string;
  // Email reporting via AWS SES (set via `wrangler secret put`)
  AWS_SES_ACCESS_KEY?: string;
  AWS_SES_SECRET_KEY?: string;
  AWS_SES_REGION?: string;
  REPORT_FROM_EMAIL?: string;
  /**
   * Where to report a summary that could not be delivered. Falls back to
   * REPORT_FROM_EMAIL, which is already a verified SES address.
   */
  ALERT_EMAIL?: string;
  /**
   * Daily summary delivery queue.
   *
   * Optional so the Worker still runs without it — local dev and the tests
   * have no queue, and fall back to sending inline. See `sendDailySummary`.
   */
  EMAIL_QUEUE?: Queue<DailySummaryJob>;
  /**
   * Workers AI, for the dashboard's daily note.
   *
   * Optional so the Worker still runs without it — local dev and the tests
   * have no binding, and fall back to the deterministic note. See
   * `generateNoteBody`.
   */
  /**
   * Daily note generation queue.
   *
   * Optional for the same reason EMAIL_QUEUE is: local dev and the tests have
   * no queue, and fall back to generating inline. See `enqueueDailyNotes`.
   */
  NOTE_QUEUE?: Queue<DailyNoteJob>;
  AI?: Ai;
  /** Overrides the model the daily note is written with. */
  DAILY_NOTE_MODEL?: string;
  /** Overrides the model new boop lines are written with. See boopLines.ts. */
  BOOP_LINES_MODEL?: string;
  /**
   * Boop line generation queue.
   *
   * Optional for the same reason NOTE_QUEUE is: local dev and the tests have
   * no queue, and fall back to generating inline. See `enqueueBoopLineRefresh`.
   */
  BOOP_LINES_QUEUE?: Queue<BoopLineJob>;
  /**
   * Web Push (VAPID), for the diaper/feeding reminder cron. All three are
   * optional so tests and local dev without them just skip sending — see
   * `pushSend.ts`.
   */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /** e.g. "mailto:someone@example.com" — required by the Web Push spec. */
  VAPID_SUBJECT?: string;
  /**
   * Reminder delivery queue.
   *
   * Optional for the same reason NOTE_QUEUE is: local dev and the tests have
   * no queue, and fall back to sending inline. See `enqueueReminderChecks`.
   */
  REMINDER_QUEUE?: Queue<ReminderJob>;
  /**
   * Feeding-trend alert delivery queue.
   *
   * Optional for the same reason REMINDER_QUEUE is: local dev and the tests
   * have no queue, and fall back to sending inline. See `feedingTrend.ts`.
   */
  FEEDING_TREND_QUEUE?: Queue<FeedingTrendJob>;
  /** Overrides the model the feeding-trend alert is analysed with. See
   *  feedingTrend.ts. */
  FEEDING_TREND_MODEL?: string;
}
