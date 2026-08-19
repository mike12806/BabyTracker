import type { DailySummaryJob } from "../scheduled/dailySummary.js";

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
}
