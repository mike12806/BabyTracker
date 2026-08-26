import type { Env } from "../types/env.js";
import { sendPushMessage } from "../pushSend.js";
import { recordAlert } from "../alerts.js";

/** Queue name, as declared in `wrangler.toml` — see `queueNames.test.ts`. */
export const REMINDER_QUEUE = "baby-tracker-reminders";

const REMINDER_THRESHOLD_MS = (2 * 60 + 45) * 60 * 1000;

export interface ReminderJob {
  subscriptionId: number;
  /** Unused for "confirmation" — there's no child to name. */
  childName: string;
  kind: "diaper" | "feeding" | "confirmation";
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
    const job: ReminderJob = { subscriptionId: sub.id, childName, kind };
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
