/**
 * The in-app alerts feed — the record behind the push notifications.
 *
 * Every alert this Worker raises is written here at the moment it is decided,
 * and the app's bell reads it back. See `migrations/0019_add_alerts.sql` for
 * why the push alone was not enough.
 *
 * Two rules hold for every caller:
 *
 * 1. **Record at the decision, not at the delivery.** The cron that decides an
 *    alert is due already claims that occasion against a double firing
 *    (`reminder_state`, `feeding_trend_checks`); the row goes in there, behind
 *    the same claim, so the feed carries exactly the alerts that were raised.
 *    Writing it in the queue consumer instead would mean one row per device,
 *    no row at all when nobody is subscribed, and nothing written when push
 *    is misconfigured — the cases the feed exists for.
 * 2. **Record even when nothing is subscribed.** An alert nobody could be
 *    pushed is the one most worth having somewhere to read.
 */

import type { Env } from "./types/env.js";
import { notifyChange } from "./live.js";

export type AlertKind = "diaper" | "feeding" | "feeding_trend";

export interface NewAlert {
  childId: number;
  kind: AlertKind;
  /** Short label for the list — "Diaper reminder", "Feeding trend". */
  title: string;
  /** The sentence that was (or would have been) pushed, stored verbatim. */
  body: string;
  /** Where tapping it should land. Same URL the push carries. */
  url?: string;
  /** Identity of the occasion — see the migration. */
  dedupeKey: string;
}

/** How long an alert stays in the feed. */
export const ALERT_RETENTION_DAYS = 30;

/**
 * Write one alert to the feed, unless its occasion is already there.
 *
 * Returns whether a row was actually inserted, which is what the tests assert
 * on and what makes a doubled cron visible in a log line rather than in the
 * feed.
 *
 * Never throws. This runs inside the cron paths that send the actual push, and
 * a feed write failing is not a reason for the notification itself not to go
 * out — the push is still the timely half. The failure is logged rather than
 * swallowed silently, because a feed that has quietly stopped recording looks
 * exactly like a quiet week.
 */
export async function recordAlert(env: Env, alert: NewAlert): Promise<boolean> {
  try {
    const result = await env.DB.prepare(
      `INSERT INTO alerts (child_id, kind, title, body, url, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (dedupe_key) DO NOTHING`,
    )
      .bind(alert.childId, alert.kind, alert.title, alert.body, alert.url ?? "/", alert.dedupeKey)
      .run();
    const recorded = (result.meta?.changes ?? 0) > 0;

    // Only on a row that was actually written. `ON CONFLICT DO NOTHING` means
    // a doubled cron firing lands here twice for one occasion, and nudging on
    // the second would have every open app refetch to find the alert it is
    // already showing.
    //
    // No origin id: this is a cron, not a device, so there is no connection to
    // skip and everyone watching the child should hear it.
    if (recorded) await notifyChange(env, alert.childId, "alerts");

    return recorded;
  } catch (error) {
    console.error(`Failed to record the alert "${alert.dedupeKey}":`, error);
    return false;
  }
}

/**
 * Close every open alert of the given kinds for one child.
 *
 * Called from the write path when an entry arrives that answers the alert —
 * see `clearReminderAlerts` in `scheduled/reminders.ts`, which owns the
 * decision about *whether* it has been answered. This function only records
 * that it has.
 *
 * Resolves for everyone linked to the child rather than for the caller, which
 * is what separates it from a dismissal: a dismissal is one person tidying
 * their own bell, while this is the underlying condition ending — the gap is
 * over for the parent who logged the feed and for the one who was asleep
 * through it alike. See `migrations/0021_add_alert_resolution.sql`.
 *
 * Returns how many rows it closed, and nudges the child's watchers when that
 * is more than none so the other caregiver's bell drops the alert without
 * waiting for their next poll. Silent at zero: the overwhelmingly common case
 * is an ordinary entry with no alert outstanding, and a nudge for every feed
 * logged would have every open app refetch for nothing.
 *
 * Never throws, for the same reason `recordAlert` doesn't: this runs inside a
 * request that is saving a feed, and failing to tidy the bell is not a reason
 * to fail the save.
 */
export async function resolveAlerts(
  env: Env,
  childId: number,
  kinds: AlertKind[],
  now = new Date(),
): Promise<number> {
  if (kinds.length === 0) return 0;
  try {
    const placeholders = kinds.map(() => "?").join(", ");
    const result = await env.DB.prepare(
      `UPDATE alerts SET resolved_at = ?
        WHERE child_id = ? AND kind IN (${placeholders}) AND resolved_at IS NULL`,
    )
      // Second precision, the format every other timestamp on this row is
      // written in — `created_at` is compared as a string against the read
      // mark, and a mixed-precision column here would be a trap for the next
      // thing that wants to sort the two against each other.
      .bind(now.toISOString().replace(/\.\d{3}Z$/, "Z"), childId, ...kinds)
      .run();
    const resolved = result.meta?.changes ?? 0;

    if (resolved > 0) await notifyChange(env, childId, "alerts");

    return resolved;
  } catch (error) {
    console.error(`Failed to resolve ${kinds.join("/")} alerts for child ${childId}:`, error);
    return 0;
  }
}

/**
 * Drop alerts older than the retention window.
 *
 * Run from the daily cron rather than on every insert: this table grows by a
 * handful of rows a day at most, so a delete on the write path would be a
 * scan bought for nothing. Nothing references an alert row, so an expired one
 * can simply go — the audit trail for a trend check lives in
 * `feeding_trend_checks` and is not pruned with it.
 */
export async function pruneAlerts(env: Env, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ALERT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const result = await env.DB.prepare("DELETE FROM alerts WHERE created_at < ?").bind(cutoff).run();
  return result.meta?.changes ?? 0;
}
