import type { Env } from "../types/env.js";
import { sendPushMessage } from "../pushSend.js";
import { recordAlert, resolveAlerts } from "../alerts.js";

/** Queue name, as declared in `wrangler.toml` — see `queueNames.test.ts`. */
export const REMINDER_QUEUE = "baby-tracker-reminders";

const REMINDER_THRESHOLD_MS = (2 * 60 + 45) * 60 * 1000;

export interface ReminderJob {
  subscriptionId: number;
  /** Unused for "confirmation" — there's no child to name. */
  childName: string;
  kind: "diaper" | "feeding" | "confirmation";
  /**
   * Which child the reminder is about, carried so the delivered notification
   * can be tagged with the gap it belongs to — see `reminderNotificationTag`.
   *
   * Optional because a job already sitting on the queue when this shipped
   * doesn't have it, and because a confirmation has no child. A tagless
   * notification still shows exactly as before; it just isn't one the app can
   * take off the lock screen later.
   */
  childId?: number;
}

const KIND_CONFIG = {
  diaper: { table: "diaper_changes", timeColumn: "time", label: "diaper change", title: "Diaper reminder" },
  feeding: { table: "feedings", timeColumn: "start_time", label: "feeding", title: "Feeding reminder" },
} as const;

/**
 * The sentence a reminder says, in one place.
 *
 * Both the push and the in-app feed row are built from this, so the alert
 * someone reads in the app tomorrow is word for word the one their phone
 * showed them — a feed that paraphrases the notification is a second version
 * of events to reconcile.
 */
export function reminderBody(childName: string, kind: "diaper" | "feeding"): string {
  return `No ${KIND_CONFIG[kind].label} logged for ${childName} in over 2 hours 45 minutes.`;
}

/**
 * The `tag` a reminder notification is shown under, and the identity the app
 * uses to take it back off the screen.
 *
 * Shared with the client (`client/src/utils/reminderNotifications.ts`), which
 * rebuilds the same string from the alerts feed: a notification whose tag no
 * longer names an open alert has been answered and is closed. Keyed on child
 * and kind rather than on the alert row, because that is the identity the OS
 * needs — a second reminder for the same child and kind should replace the
 * one on the lock screen, not stack a duplicate beneath it.
 */
export function reminderNotificationTag(childId: number, kind: "diaper" | "feeding"): string {
  return `reminder:${childId}:${kind}`;
}

/**
 * Close the open reminder alerts of one kind for a child, if the entry that
 * just arrived actually answers them.
 *
 * Called from the create path for feedings and diaper changes (see
 * `routes/crud.ts`). The condition is deliberately the *same* one the cron
 * uses to raise the alert, asked of the table rather than of the entry that
 * was just posted: an alert says "nothing logged in over 2 hours 45 minutes",
 * so it is answered exactly when that has stopped being true. Backfilling
 * last night's 2am feed therefore does not clear this morning's reminder —
 * the child is still overdue, the alert is still telling the truth, and
 * clearing it on the strength of any entry at all would let a bit of
 * record-keeping silence a live one.
 *
 * Returns whether anything was closed.
 */
export async function clearReminderAlerts(
  env: Env,
  childId: number,
  kind: "diaper" | "feeding",
  now = new Date(),
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - REMINDER_THRESHOLD_MS).toISOString();
  const { table, timeColumn } = KIND_CONFIG[kind];

  const recent = await env.DB.prepare(
    `SELECT 1 AS ok FROM ${table} WHERE child_id = ? AND ${timeColumn} >= ? LIMIT 1`,
  )
    .bind(childId, cutoff)
    .first<{ ok: number }>();

  if (!recent) return false;

  // The gap `reminder_state` is holding open has just been answered, so the
  // claim on it is spent. Dropping it matters because that row remembers the
  // *clock time the push went out*, not the entry that ended the gap: give
  // the feed its real time — 11:58, a minute or two before the reminder that
  // prompted it landed — and the next check finds `last_notified_at` still
  // ahead of the newest activity and stays quiet, swallowing the following
  // gap's reminder entirely. With the row gone the next gap is judged on the
  // entries alone, which is the only thing that should decide it.
  //
  // This cannot make it nag twice about one gap: a fresh notification still
  // needs a fresh 2 hour 45 minute silence, and we have just established
  // there isn't one.
  await env.DB.prepare("DELETE FROM reminder_state WHERE child_id = ? AND kind = ?")
    .bind(childId, kind)
    .run();

  return (await resolveAlerts(env, childId, [kind], now)) > 0;
}

const childNameExpr = `TRIM(first_name || CASE WHEN last_name IS NOT NULL AND last_name != '' THEN ' ' || last_name ELSE '' END)`;

/**
 * Runs on the reminder cron (every 5 minutes — see `wrangler.toml`). For
 * every child and kind (diaper/feeding), decides whether a reminder is due —
 * no recorded entry in the last 2 hours 45 minutes, and no reminder already
 * sent for this same gap — and if so enqueues one delivery job per device
 * subscribed to that child.
 *
 * The "already sent for this gap" check and the `reminder_state` update both
 * happen here, not in the queue consumer: once a reminder is queued the gap
 * counts as handled, the same way an email counts as sent once it's queued in
 * `dailySummary.ts` — a slow or retried push delivery must not cause a second
 * round of jobs for the same gap.
 */
export async function enqueueReminderChecks(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - REMINDER_THRESHOLD_MS).toISOString();

  const children = await env.DB.prepare(`SELECT id, ${childNameExpr} AS name FROM children`).all<{
    id: number;
    name: string;
  }>();

  for (const child of children.results) {
    for (const kind of ["diaper", "feeding"] as const) {
      await checkOne(env, child.id, child.name, kind, cutoff);
    }
  }
}

async function checkOne(
  env: Env,
  childId: number,
  childName: string,
  kind: "diaper" | "feeding",
  cutoff: string
): Promise<void> {
  const { table, timeColumn } = KIND_CONFIG[kind];

  const last = await env.DB.prepare(
    `SELECT ${timeColumn} AS t FROM ${table} WHERE child_id = ? ORDER BY ${timeColumn} DESC LIMIT 1`
  )
    .bind(childId)
    .first<{ t: string }>();

  // Not overdue: something was logged inside the last 2 hours 45 minutes.
  if (last && last.t >= cutoff) return;
  const lastActivityAt = last?.t ?? "0000-01-01T00:00:00Z";

  const state = await env.DB.prepare(`SELECT last_notified_at FROM reminder_state WHERE child_id = ? AND kind = ?`)
    .bind(childId, kind)
    .first<{ last_notified_at: string }>();

  // Already notified for this exact gap — wait for a newer entry (which
  // moves lastActivityAt past last_notified_at) before nagging again.
  if (state && state.last_notified_at >= lastActivityAt) return;

  await env.DB.prepare(
    `INSERT INTO reminder_state (child_id, kind, last_notified_at) VALUES (?, ?, ?)
     ON CONFLICT(child_id, kind) DO UPDATE SET last_notified_at = excluded.last_notified_at`
  )
    .bind(childId, kind, new Date().toISOString())
    .run();

  // The in-app record, written here rather than in the queue consumer and
  // before the fan-out below, so it exists even when this child has no
  // subscribed devices at all — see `alerts.ts`. Keyed on the same gap the
  // claim above guards, so a doubled cron cannot double-log it either.
  await recordAlert(env, {
    childId,
    kind,
    title: KIND_CONFIG[kind].title,
    body: reminderBody(childName, kind),
    dedupeKey: `reminder:${childId}:${kind}:${lastActivityAt}`,
  });

  const subscriptions = await env.DB.prepare(
    `SELECT ps.id FROM push_subscriptions ps
     JOIN user_children uc ON uc.user_id = ps.user_id
     WHERE uc.child_id = ?`
  )
    .bind(childId)
    .all<{ id: number }>();

  for (const sub of subscriptions.results) {
    const job: ReminderJob = { subscriptionId: sub.id, childName, kind, childId };
    if (env.REMINDER_QUEUE) {
      await env.REMINDER_QUEUE.send(job);
    } else {
      // No queue bound (local dev/tests) — send inline.
      await deliverReminder(env, job);
    }
  }
}

/** Sends one reminder push for one job; run from the queue consumer. */
export async function deliverReminder(env: Env, job: ReminderJob): Promise<void> {
  const sub = await env.DB.prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE id = ?`)
    .bind(job.subscriptionId)
    .first<{ endpoint: string; p256dh: string; auth: string }>();

  // Unsubscribed between enqueue and delivery — nothing to do.
  if (!sub) return;

  if (job.kind === "confirmation") {
    await sendPushMessage(env, sub, {
      title: "Baby Tracker",
      body: "Reminders are on. We'll notify you here when one's due.",
      url: "/",
    });
    return;
  }

  await sendPushMessage(env, sub, {
    title: "Baby Tracker",
    body: reminderBody(job.childName, job.kind),
    url: "/",
    // Absent on a job queued before this field existed — the service worker
    // simply shows an untagged notification then, exactly as it used to.
    tag: job.childId ? reminderNotificationTag(job.childId, job.kind) : undefined,
  });
}

/**
 * Queues (or, with no queue bound, sends inline) the confirmation push a
 * fresh subscription gets right away — see `routes/push.ts`. Shares the
 * reminder queue's retry behavior rather than being a fire-and-forget best
 * effort, same reasoning as every other push send here: a push-service
 * hiccup should be retried, not silently lost.
 */
export async function enqueueConfirmation(env: Env, subscriptionId: number): Promise<void> {
  const job: ReminderJob = { subscriptionId, childName: "", kind: "confirmation" };
  if (env.REMINDER_QUEUE) {
    await env.REMINDER_QUEUE.send(job);
  } else {
    await deliverReminder(env, job);
  }
}
