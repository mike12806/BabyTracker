import type { Env } from "../types/env.js";
import type { DomainEvent } from "./types.js";
import { SUBSCRIBERS } from "./subscribers.js";

/**
 * The domain event bus: one queue, one dispatching consumer.
 *
 * ## Publishing
 *
 * `emit` puts the event on `baby-tracker-events` and returns. It never throws
 * and never blocks the response on a subscriber — which is the entire point,
 * and also the one behaviour change this bus makes: `clearReminderAlerts` used
 * to run inline, before the 201 went back, and now runs a moment later on the
 * consumer. So there is a brief window in which the phone that just logged a
 * feed still shows the reminder that feed answered.
 *
 * That is a real regression of a kind, and it is the trade this bus is: the
 * create path already declared this work non-critical — "an alert left
 * standing is a stale bell, not a lost entry, so it must not be able to fail
 * the save" — and something that must not fail the save has no business being
 * awaited by it either. The bell catches up on the next refresh, which the
 * other caregiver's device was always waiting for anyway.
 *
 * ## One queue, not one per subscriber
 *
 * Cloudflare Queues gives one consumer per queue, so N independent subscribers
 * means either a consumer that dispatches in process (this) or N queues and N
 * sends per event (the other option). The cost of this shape is a shared retry
 * fate: when one subscriber fails the message is retried, and every subscriber
 * on it runs again.
 *
 * That cost is affordable here precisely because it was already paid. Every
 * handler on this bus has to be idempotent, and the ones being moved onto it
 * already were — `clearReminderAlerts` finds nothing open on a second run,
 * which is what made a deduplicated create retry safe long before the bus. A
 * subscriber that ever needs its own retry budget gets its own queue; until
 * one does, six queues is enough for this Worker.
 *
 * ## What is deliberately not on the bus
 *
 * The live nudge. `announceChange` stays inline on every write path it is on
 * today, because a queue hop is latency and the nudge is the one piece of this
 * whose whole job is to feel instant. It is also not a reaction to a change in
 * the way a subscriber is — it *is* the change, reaching the other device. The
 * split is the ordinary one: a read model updated synchronously, everything
 * else asynchronously.
 *
 * ## Without the binding
 *
 * `EVENTS` is optional, like every other queue here, and `emit` falls back to
 * dispatching inline. So the tests and local dev without `wrangler dev` behave
 * exactly as they did before this file existed — including the ordering, which
 * is why the existing create tests still pass unchanged.
 */

/** The queue name, as declared in `wrangler.toml`. */
export const EVENTS_QUEUE = "baby-tracker-events";

/**
 * Publish one event.
 *
 * Swallows its own failures. A queue send that fails means a subscriber does
 * not run, and every subscriber on this bus is doing work the write path
 * already declared must not be able to fail the save — so raising here would
 * turn a stale bell into a failed feed, which is strictly the worse outcome.
 *
 * Pass `waitUntil` from anything serving a request. The send is not awaited
 * then, so publishing costs the response nothing at all; without it the send
 * is awaited, which is correct but puts a queue round trip back on the path.
 */
export async function emit(
  env: Env,
  event: DomainEvent,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<void> {
  if (!env.EVENTS) {
    // No queue bound — tests, local dev. Run the subscribers here and now, so
    // behaviour matches what the inline calls did before the bus.
    await dispatch(env, event);
    return;
  }

  const send = env.EVENTS.send(event).catch((error) => {
    console.error(`Event publish failed for ${event.type}:`, error);
  });
  if (waitUntil) waitUntil(send);
  else await send;
}

/**
 * Run every subscriber that cares about this event.
 *
 * Each one is isolated, so a subscriber that throws cannot stop the others
 * from running — a failure should cost its own reaction and no one else's.
 * Once they have all had their turn, a failure is rethrown so the consumer
 * retries the message; with subscribers required to be idempotent, the ones
 * that already succeeded simply do nothing the second time.
 */
export async function dispatch(env: Env, event: DomainEvent): Promise<void> {
  const interested = SUBSCRIBERS.filter((subscriber) => subscriber.handles(event));
  const failures: string[] = [];

  for (const subscriber of interested) {
    try {
      await subscriber.handle(env, event);
    } catch (error) {
      failures.push(
        `${subscriber.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.error(`Subscriber "${subscriber.name}" failed on ${event.type}:`, error);
    }
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length} subscriber(s) failed: ${failures.join("; ")}`);
  }
}
