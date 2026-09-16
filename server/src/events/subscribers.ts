import type { Env } from "../types/env.js";
import type { DomainEvent } from "./types.js";
import { clearReminderAlerts } from "../scheduled/reminders.js";

/**
 * One reaction to an event.
 *
 * `handles` is separate from `handle` so the dispatcher can tell "this
 * subscriber does not care" apart from "this subscriber ran and did nothing" —
 * the first is not worth a log line and the second sometimes is.
 */
export interface Subscriber {
  /** Stable name, used in log lines when this one throws. */
  name: string;
  handles(event: DomainEvent): boolean;
  handle(env: Env, event: DomainEvent): Promise<void>;
}

/**
 * Which table's entries answer which overdue reminder.
 *
 * This lived on the route config (`clearsReminderKind` in `crud.ts`) and has
 * moved here, which is the shape of the whole change in miniature: that a feed
 * closes a feeding reminder is a fact about the domain, not about the route
 * that happens to write feeds. The route no longer needs to know reminders
 * exist.
 */
const REMINDER_KIND_BY_TABLE: Record<string, "diaper" | "feeding"> = {
  feedings: "feeding",
  diaper_changes: "diaper",
};

/**
 * An overdue reminder is a statement about a *gap*, so the entry that ends the
 * gap ends the alert: it comes off everyone's bell, not just the logger's, and
 * the notification comes off the lock screen on the next refresh.
 *
 * Only creates. An edit or a delete cannot answer a reminder — and could not
 * be trusted to if it tried, since `clearReminderAlerts` decides by re-asking
 * the table whether anything is logged inside the threshold rather than by
 * trusting the entry it was handed. That is also what makes it safe to run
 * late, which a queued subscriber sometimes will: it evaluates the world at
 * the moment it runs, not the world as it was at emit time.
 */
const reminderResolution: Subscriber = {
  name: "reminder-resolution",
  handles: (event) =>
    event.type === "entry.created" && event.table in REMINDER_KIND_BY_TABLE,
  handle: async (env, event) => {
    const kind = REMINDER_KIND_BY_TABLE[event.table];
    await clearReminderAlerts(env, event.childId, kind);
  },
};

/**
 * Every subscriber, in the order the dispatcher runs them.
 *
 * Order is not significance: the dispatcher runs them all regardless of what
 * any one of them does, and nothing here may depend on another having run
 * first. If two subscribers ever do need ordering, that is a sign they are one
 * subscriber.
 *
 * **Every subscriber must be idempotent.** The dispatcher retries the whole
 * message when any one of them fails, so a handler can and will be run twice
 * on the same event. That is a cheap requirement here rather than a new
 * burden: `clearReminderAlerts` already finds nothing open on a second run and
 * does nothing, which is exactly what the create path relied on for a
 * deduplicated retry long before this bus existed.
 */
export const SUBSCRIBERS: Subscriber[] = [reminderResolution];
