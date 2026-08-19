import type { DailySummaryJob } from "../scheduled/dailySummary.js";
import type { DailyNoteJob } from "../scheduled/dailyNote.js";

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
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
}
