/**
 * The domain events this Worker publishes, and what each one carries.
 *
 * ## Why these exist
 *
 * Before the bus, a write did its own fan-out. `createChildScopedCrud`'s POST
 * inserted the row, then called `clearReminderAlerts`, then `announceChange` —
 * in that order, inline, on the response path. Adding anything that should
 * happen when a feed is logged meant editing `crud.ts`, and there were 18
 * `announceChange` call sites across four route files doing the same by hand.
 *
 * An event inverts that. The write says *what happened* once; whatever cares
 * subscribes. The write path stops being the place where the list of
 * consequences lives.
 *
 * ## What an event carries, and what it deliberately does not
 *
 * Identity, never the row. `{ type, childId, table, entryId, … }` and nothing
 * about the entry's contents — which is the same rule `src/live.ts` already
 * states for what crosses the socket, arrived at from the same direction: a
 * queued message can be delivered well after the row it names has changed
 * again, so a snapshot taken at emit time is a value that was true once and
 * may not be now. A subscriber that needs the entry re-reads D1 and gets the
 * current answer.
 *
 * It also means an event is cheap to carry and impossible to make stale, and
 * that nothing about a child ends up sitting in a queue's retention window.
 *
 * `at` is when the *event* was emitted, not the entry's own timestamp. The two
 * differ constantly — a feed logged at 11:58 and saved at 12:03, an outbox
 * flush replaying yesterday's entry — and a subscriber reasoning about the gap
 * a feed closes wants the entry's time, from D1, not this one.
 */

/** Every event type on the bus. One string, so a subscriber can switch on it. */
export type DomainEventType = "entry.created" | "entry.updated" | "entry.deleted";

export interface DomainEvent {
  type: DomainEventType;
  /** The child the entry belongs to. Every subscriber so far scopes by this. */
  childId: number;
  /** The D1 table the entry lives in — `feedings`, `diaper_changes`, … */
  table: string;
  /** The row's id, for a subscriber that needs to go and read it. */
  entryId: number;
  /**
   * The caregiver who did it. Carried because a subscriber may need to treat
   * the actor differently from everyone else — not used by anything today, and
   * cheap enough that leaving it out would be the odd choice.
   */
  actorUserId: number;
  /** When this event was emitted, ISO 8601. Not the entry's own timestamp. */
  at: string;
}

/**
 * Build one event, stamping `at`.
 *
 * A function rather than an object literal at each call site so the timestamp
 * cannot be forgotten, and so adding a field later is one edit.
 */
export function entryEvent(
  type: DomainEventType,
  fields: Omit<DomainEvent, "type" | "at">,
): DomainEvent {
  return { type, ...fields, at: new Date().toISOString() };
}
