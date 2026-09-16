import type { Env } from "./types/env.js";

/**
 * Workers Analytics Engine — a record of what this Worker's infrastructure
 * actually did, as opposed to what it was designed to do.
 *
 * ## Why this exists
 *
 * Almost every piece of infrastructure in this Worker is built to fail
 * quietly, and deliberately so: a missing `AI` binding writes the template
 * note, a KV hiccup degrades to a D1 read, a push to a dead subscription
 * deletes the row, a queue consumer retries. Each of those is the right
 * behaviour on its own, and together they add up to a system that cannot tell
 * you the difference between working and barely working. The daily note has a
 * three-model fallback chain; nothing today answers "how often do we reach the
 * second model", or "did anyone get a real note this week". The `source`
 * column in `child_daily_notes` answers it for notes, one row at a time, and
 * nothing answers it for the rest.
 *
 * So: one data point per interesting outcome, written to a time-series dataset
 * that is queryable over months in SQL. Not logs — `console.error` already
 * covers "this specific thing went wrong, here is the message". This covers
 * the shape of the failures over time, which is the thing a log line cannot be
 * aggregated into after the fact.
 *
 * ## The positional schema, and why it is append-only
 *
 * Analytics Engine has no column names. A data point is `blobs: string[]` and
 * `doubles: number[]`, stored as `blob1..blob20` and `double1..double20`, and
 * the SQL API addresses them *by position*. That makes the layout below load
 * bearing in a way a normal struct is not: moving what lives in `blob3` does
 * not break a query, it changes what the query means, and a window spanning
 * the deploy silently mixes both meanings into one number.
 *
 * The rule is therefore the same one `KV_SCHEMA_VERSION` enforces next door,
 * arrived at from the other direction: **a position, once used, keeps its
 * meaning forever.** Add a field at the end; never repurpose one. `blob1` is
 * always the event name, so a query can filter to the events it understands
 * and ignore the rest. Unlike KV there is no version to bump — data points are
 * historical facts, not a cache, and rewriting what the old ones meant is not
 * on the table.
 *
 * ## Failure is not an error
 *
 * Same contract as `src/kv/cache.ts`: `METRICS` is optional, every function
 * here swallows what it throws, and nothing calls into it on a path whose
 * correctness depends on the answer. Instrumentation that can fail the thing
 * it measures is worse than no instrumentation — and the tests and local dev
 * have no binding at all, so the no-op path is the one that runs most often.
 *
 * `writeDataPoint` does not return a promise: it hands the point to the
 * runtime and returns, so there is nothing to await and nothing to put in a
 * `waitUntil`. That is why these calls are plain statements rather than
 * something a caller has to remember to keep alive.
 */

/**
 * Which feature asked a model for prose. Matches the three `[ai]` callers.
 */
export type GenerationFeature = "daily_note" | "boop_lines" | "feeding_trend";

/** Whether the model answered, or the deterministic template stood in. */
export type GenerationSource = "ai" | "fallback";

/** What a queue consumer decided about one message. */
export type QueueOutcome = "ack" | "retry";

/**
 * What became of one Web Push send.
 *
 * `expired` is the 404/410 case — the push service saying the subscription is
 * gone for good — which is a normal outcome rather than a failure, and is
 * worth separating from `failed` precisely because it looks like one. A
 * household whose sends are mostly `expired` has devices that silently
 * unsubscribed, which is invisible from anywhere else.
 */
export type PushOutcome = "sent" | "expired" | "failed" | "skipped";

/**
 * Write one point, or do nothing at all.
 *
 * The single choke point every event below goes through, so the "never throw"
 * contract is held in one place rather than in each of them.
 */
function write(env: Env, blobs: string[], doubles: number[]): void {
  if (!env.METRICS) return;
  try {
    env.METRICS.writeDataPoint({
      // The index is what Analytics Engine samples and groups by at scale.
      // The event name is the right choice: it is low cardinality and it is
      // what every query starts by filtering on.
      indexes: [blobs[0]],
      blobs,
      doubles,
    });
  } catch (error) {
    console.error("Analytics Engine write failed:", error);
  }
}

/**
 * A model was asked for prose, and either wrote it or did not.
 *
 * blob1 "generation" · blob2 feature · blob3 source · blob4 model · blob5 reason
 * double1 1 when the model answered, 0 when the template stood in
 *
 * `double1` duplicates `blob3` on purpose: it is what makes `avg(double1)` a
 * success rate, which is the one number anybody actually wants out of this and
 * is awkward to get from a string.
 *
 * `reason` is this Worker's own diagnostic string — the model name, a finish
 * reason, a thrown message — and never the generated text, which is about
 * somebody's child. `describeReply` in `dailyNote.ts` holds that same line.
 */
export function recordGeneration(
  env: Env,
  feature: GenerationFeature,
  source: GenerationSource,
  model: string,
  reason?: string,
): void {
  write(
    env,
    ["generation", feature, source, model, reason ?? ""],
    [source === "ai" ? 1 : 0],
  );
}

/**
 * A queue consumer finished with one message.
 *
 * blob1 "queue" · blob2 queue name · blob3 outcome
 * double1 the message's attempt count · double2 1 when acked, 0 when retried
 *
 * The attempt count is the point of recording this at all. A queue that acks
 * everything on the first attempt and one that acks everything on the third
 * look identical from the outside — both drain, nothing dead-letters — and
 * only the second one is quietly eating its `max_retries` budget and would
 * start losing messages if the failure rate rose slightly.
 */
export function recordQueueOutcome(
  env: Env,
  queue: string,
  outcome: QueueOutcome,
  attempts: number,
): void {
  write(env, ["queue", queue, outcome], [attempts, outcome === "ack" ? 1 : 0]);
}

/**
 * One Web Push send finished.
 *
 * blob1 "push" · blob2 what the push was about · blob3 outcome
 * double1 1 when it reached the push service, 0 otherwise
 */
export function recordPush(env: Env, kind: string, outcome: PushOutcome): void {
  write(env, ["push", kind, outcome], [outcome === "sent" ? 1 : 0]);
}

/**
 * A read went through the KV cache.
 *
 * blob1 "cache" · blob2 key kind · blob3 "hit" | "miss"
 * double1 1 on a hit, 0 on a miss
 *
 * The *kind* rather than the key: `daily-note:7` and `daily-note:8` are the
 * same question asked about two children, and a hit rate is only meaningful
 * once they are counted together. Cardinality is free here — Analytics Engine
 * charges per data point, not per distinct value — so this is about the
 * queries being readable, not about cost.
 *
 * This is the one event written on the request path, which is why it is a
 * single non-blocking call and not, for instance, a D1 write. It is also the
 * one that most directly checks a design decision: `server/AGENTS.md` argues
 * at length about which values may live in KV, and a hit rate is the only
 * evidence that would ever say those arguments were wrong.
 */
export function recordCacheAccess(env: Env, kind: string, hit: boolean): void {
  write(env, ["cache", kind, hit ? "hit" : "miss"], [hit ? 1 : 0]);
}

/**
 * The kind of thing a cache key names, for grouping.
 *
 * Keys are built by `kv/keys.ts` as `v<n>:<kind>` or `v<n>:<kind>:<instance>`,
 * so the kind is the second colon-separated field. Anything that does not look
 * like that is reported as `other` rather than guessed at — a mislabelled data
 * point is worse than an unlabelled one, because it lands in somebody else's
 * total.
 */
export function cacheKeyKind(key: string): string {
  return key.split(":")[1] || "other";
}
