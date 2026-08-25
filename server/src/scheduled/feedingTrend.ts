/**
 * Three times a day — 11am, 4pm and 7pm Eastern — this looks at how much a
 * child has been fed *so far today* against how much they had been fed by the
 * same point on each of the previous seven days, asks the model whether the
 * difference is worth a parent's attention, and pushes a notification when it
 * says yes.
 *
 * It follows the same three rules the rest of the AI features here follow:
 *
 * 1. **The numbers are computed here, never by the model.** Same reason as the
 *    daily note (see dailyNote.ts): an LLM asked to do arithmetic on feed
 *    counts gets it wrong often enough that a notification which misreports
 *    how much a baby ate is worse than no notification. The model is handed
 *    finished figures.
 * 2. **The model can only ever veto an alert, never invent one.** The
 *    shortfall is decided in `compareFeeding` from the figures; the model is
 *    asked only when that screen has already found one, and its job is to say
 *    whether it's worth a phone buzz and to write the sentence. A model that
 *    is down, rate-limited, or babbling therefore costs a nicer wording, never
 *    a missed alert — and can never produce an alert the numbers don't
 *    support.
 * 3. **The decision happens on the cron, the sending happens on the queue** —
 *    same split as reminders.ts, so a push-service hiccup is retried for that
 *    one device without re-deciding anything or re-notifying the others.
 *
 * Deliberately unlike the daily note in one respect: a model failure here is
 * *not* retried on the queue. This alert is about the day it is still in — a
 * "behind by 11am" push that lands at noon has already lost most of its point
 * — and the template sentence says the same true numbers, so falling straight
 * through to it beats waiting for a better wording.
 */

import type { Env } from "../types/env.js";
import { sendPushMessage } from "../pushSend.js";
import {
  etMidnightToUtc,
  toEtDateStr,
  volumeTotal,
  type AmountRow,
  type VolumeUnit,
} from "./dailySummary.js";

/** Queue carrying one push-delivery job per subscribed device. */
export const FEEDING_TREND_QUEUE = "baby-tracker-feeding-trend";

/**
 * The checkpoints, as Eastern clock hours: late morning, late afternoon, and
 * evening. Chosen so each one has enough of the day behind it to mean
 * something and enough of it left to act on — a "you're behind" push at 10pm
 * is just a bad night's sleep with extra steps.
 *
 * These are ET hours, not UTC ones. See FEEDING_TREND_CRON in index.ts for how
 * a UTC cron is made to land on them year-round.
 */
export const CHECKPOINT_HOURS = [11, 16, 19] as const;

/** Days of history the comparison averages over — the "prior week". */
export const BASELINE_DAYS = 7;

/**
 * Baseline days that must actually have a feeding logged before any alert is
 * possible.
 *
 * The mean is taken over the days that have data rather than over all seven,
 * because a family that started logging on Thursday would otherwise have four
 * empty days dragging their average to near zero — which reads as "doing
 * great" and silently switches the feature off. The flip side is that a
 * genuinely quiet day counts as data, which is correct: nobody can tell "the
 * baby didn't feed" from "nobody wrote it down", and treating a real quiet day
 * as missing would bias the baseline high and cry wolf.
 */
export const MIN_BASELINE_DAYS = 3;

/** Below this, a shortfall against the baseline is noise, not a trend. Same
 *  threshold the daily note's trend arrows use. */
export const SHORTFALL_THRESHOLD = 0.15;

/** A push body longer than this gets truncated by the OS anyway. */
export const MAX_ALERT_LENGTH = 160;

/**
 * Same model chain as the daily note, for the same reasons (see
 * DEFAULT_NOTE_MODEL in dailyNote.ts): it is the one already proven to write
 * in this voice on this account, and the second entry is deliberately an
 * older, smaller, non-thinking model that answers in a different response
 * shape, so it is unlikely to fail the same way at the same time.
 *
 * This prompt asks for a judgement and a JSON object rather than prose, which
 * is the more demanding of the two jobs — but the judgement is a floor, not a
 * ceiling: the figures have already established that there *is* a shortfall,
 * and a model that answers unusably falls through to the template with the
 * alert intact. Override with FEEDING_TREND_MODEL to try a different one
 * without a code change.
 */
export const DEFAULT_TREND_MODEL = "@cf/google/gemma-4-26b-a4b-it";
export const TREND_MODEL_CHAIN = [
  DEFAULT_TREND_MODEL,
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
];

/** Generous, because the default model thinks before it answers — the daily
 *  note lost a fortnight of real notes to a budget the reasoning trace ate. */
export const MAX_REPLY_TOKENS = 1000;

/**
 * The unit the alert speaks in. Fixed at oz rather than each reader's own
 * display setting, for the same reason the daily note is: one analysis is
 * shared by everyone linked to the child, so it cannot be per-user.
 */
const TREND_VOLUME_UNIT: VolumeUnit = "oz";

/** Feeding in one window — today so far, or the same span on a past day. */
export interface FeedingWindowStats {
  feeds: number;
  /** Total in oz, or null when nothing in the window was measured by volume
   *  (all-breastfeeding days log no amount at all). */
  volumeOz: number | null;
  /** When the last feed in the window started, for context in the message. */
  lastFeedAt: string | null;
}

export interface FeedingBaseline {
  /** Mean feeds per day, over `days` — the days that had any feeding logged. */
  feeds: number;
  /** Mean oz per day over the baseline days that measured any volume, or null
   *  when none did. */
  volumeOz: number | null;
  /** Baseline days with a feeding logged by this point in the day. */
  days: number;
}

export interface FeedingComparison {
  today: FeedingWindowStats;
  baseline: FeedingBaseline;
  /** Fractional change against the baseline, e.g. -0.4 for "40% below".
   *  Null when there is no baseline to divide by. */
  feedsChange: number | null;
  volumeChange: number | null;
  /** The figures show a real shortfall. The model is only consulted when this
   *  is true, and can only turn it back off. */
  below: boolean;
  /** Why no shortfall was found, when none was. */
  reason?: "no-baseline" | "on-track";
}

/** One device's copy of an alert, as it travels through the queue. The body
 *  travels with it: a retry must deliver the sentence that was decided on,
 *  not re-run an analysis against a clock that has moved. */
export interface FeedingTrendJob {
  subscriptionId: number;
  /** For log lines only — the body already names the child. */
  childName: string;
  body: string;
}

/** What one child's check decided, and why. Returned to the manual route and
 *  used for the log line. */
export interface FeedingTrendCheck {
  childId: number;
  firstName: string;
  checkDate: string;
  checkpoint: number;
  checkpointLabel: string;
  comparison: FeedingComparison;
  /** The sentence that was (or would have been) pushed. Null when the figures
   *  never got as far as needing one. */
  body: string | null;
  source: "ai" | "fallback" | null;
  /** A push actually went out (or was queued) for this check. */
  alerted: boolean;
  /** Why no push went out, when none did. */
  skipped?:
    | "no-baseline"
    | "on-track"
    | "already-checked"
    | "model-declined"
    | "no-subscribers"
    | "preview";
  /** What the model did, when it didn't write the body. Logged, not stored. */
  reason?: string;
}

interface ChildRow {
  id: number;
  first_name: string;
}

interface FeedingRow extends AmountRow {
  start_time: string;
}

// ── Time windows ─────────────────────────────────────────────────────────────

/** The Eastern clock hour (0-23) at a given instant. */
export function etHour(date: Date): number {
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hour12: false,
    }).format(date),
    10,
  );
  // hour12:false yields "24" for midnight in some Intl implementations.
  return hour === 24 ? 0 : hour;
}

/** "11am", "4pm", "7pm" — how the checkpoint is said out loud in the alert. */
export function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${suffix}`;
}

/** The checkpoint this instant belongs to, or null if it isn't one. The gate
 *  the cron runs through — see FEEDING_TREND_CRON in index.ts. */
export function checkpointFor(now: Date): number | null {
  const hour = etHour(now);
  return (CHECKPOINT_HOURS as readonly number[]).includes(hour) ? hour : null;
}

export interface TrendWindows {
  /** ET calendar date being checked, `YYYY-MM-DD`. */
  checkDate: string;
  /** Today, from ET midnight up to now. */
  todayStart: string;
  todayEnd: string;
  /** The same elapsed span on each of the previous BASELINE_DAYS ET days,
   *  most recent first. */
  baseline: { start: string; end: string }[];
}

/**
 * Today so far, and the same span on each of the previous seven days.
 *
 * Each baseline window is the same *duration* as today's rather than ending at
 * the same wall-clock time, so the comparison is like-for-like even across a
 * daylight saving change — an hour of extra or missing wall clock would
 * otherwise show up as a feeding trend. Days are walked back one ET midnight
 * at a time (via the 12-hour nudge `computeDailyWindow` uses) rather than by
 * subtracting 24 hours, so a 23- or 25-hour day still lines up on the right
 * calendar date.
 */
export function buildTrendWindows(now: Date): TrendWindows {
  const checkDate = toEtDateStr(now);
  const todayStart = etMidnightToUtc(checkDate);
  const todayEnd = now.toISOString();
  const elapsedMs = Math.max(0, new Date(todayEnd).getTime() - new Date(todayStart).getTime());

  const baseline: { start: string; end: string }[] = [];
  let cursor = todayStart;
  for (let i = 0; i < BASELINE_DAYS; i++) {
    // 12 hours before this day's ET midnight lands squarely in the previous ET
    // day whatever the offset did overnight.
    const previousEtDate = toEtDateStr(new Date(new Date(cursor).getTime() - 12 * 60 * 60 * 1000));
    cursor = etMidnightToUtc(previousEtDate);
    baseline.push({
      start: cursor,
      end: new Date(new Date(cursor).getTime() + elapsedMs).toISOString(),
    });
  }

  return { checkDate, todayStart, todayEnd, baseline };
}

// ── Figures ──────────────────────────────────────────────────────────────────

export async function fetchFeedingWindow(
  env: Env,
  childId: number,
  start: string,
  end: string,
): Promise<FeedingWindowStats> {
  const { results } = await env.DB.prepare(
    "SELECT start_time, amount, amount_unit FROM feedings WHERE child_id = ? AND start_time >= ? AND start_time < ? ORDER BY start_time",
  )
    .bind(childId, start, end)
    .all<FeedingRow>();

  const volume = volumeTotal(results, TREND_VOLUME_UNIT);
  return {
    feeds: results.length,
    volumeOz: volume?.value ?? null,
    lastFeedAt: results.length > 0 ? results[results.length - 1].start_time : null,
  };
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** Percentage below the baseline, as a whole number — "38% below". */
function pctBelow(change: number): string {
  return `${Math.round(Math.abs(change) * 100)}%`;
}

/**
 * Today against the mean of the baseline days that have data.
 *
 * Volume and feed count are screened independently and either can raise the
 * flag: a day of the usual number of much smaller bottles is a shortfall the
 * count alone would miss, and a day of fewer but bigger ones is one the volume
 * alone would. Volume is only compared when both sides actually measured some
 * — a household that breastfeeds and logs no amounts is not "0 oz below".
 */
export function compareFeeding(
  today: FeedingWindowStats,
  baselineDays: FeedingWindowStats[],
): FeedingComparison {
  const withData = baselineDays.filter((d) => d.feeds > 0);
  const baseline: FeedingBaseline = {
    feeds:
      withData.length > 0 ? withData.reduce((sum, d) => sum + d.feeds, 0) / withData.length : 0,
    volumeOz: null,
    days: withData.length,
  };

  const withVolume = withData.filter((d) => d.volumeOz != null);
  if (withVolume.length > 0) {
    baseline.volumeOz =
      withVolume.reduce((sum, d) => sum + (d.volumeOz ?? 0), 0) / withVolume.length;
  }

  const feedsChange = baseline.feeds > 0 ? (today.feeds - baseline.feeds) / baseline.feeds : null;
  const volumeChange =
    baseline.volumeOz != null && baseline.volumeOz > 0 && today.volumeOz != null
      ? (today.volumeOz - baseline.volumeOz) / baseline.volumeOz
      : null;

  if (baseline.days < MIN_BASELINE_DAYS) {
    return { today, baseline, feedsChange, volumeChange, below: false, reason: "no-baseline" };
  }

  const below =
    (feedsChange != null && feedsChange < -SHORTFALL_THRESHOLD) ||
    (volumeChange != null && volumeChange < -SHORTFALL_THRESHOLD);

  return {
    today,
    baseline,
    feedsChange,
    volumeChange,
    below,
    reason: below ? undefined : "on-track",
  };
}

// ── The message ──────────────────────────────────────────────────────────────

/**
 * The alert when there is no model to write one — and the reason the feature
 * can be relied on. It says the same true figures, just in a fixed voice.
 */
export function fallbackAlert(
  firstName: string,
  checkpointLabel: string,
  comparison: FeedingComparison,
): string {
  const { today, baseline, feedsChange, volumeChange } = comparison;

  const parts = [`${today.feeds} ${today.feeds === 1 ? "feed" : "feeds"}`];
  if (today.volumeOz != null) parts.push(`${round1(today.volumeOz)} oz`);

  const usual = [`${round1(baseline.feeds)}`];
  if (baseline.volumeOz != null && today.volumeOz != null) {
    usual.push(`${round1(baseline.volumeOz)} oz`);
  }

  const worst =
    volumeChange != null && (feedsChange == null || volumeChange < feedsChange)
      ? volumeChange
      : feedsChange;
  const gap = worst != null ? ` — ${pctBelow(worst)} below.` : ".";

  return `${firstName} has had ${parts.join(", ")} by ${checkpointLabel}, against ${usual.join(", ")} by now on an average day last week${gap}`;
}

/** Model output is text from a machine: one line, no wrapping quotes, no
 *  runaway length. Empty means "use the fallback". */
export function tidyAlert(raw: string): string | null {
  const oneLine = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
  if (oneLine.length < 20) return null;
  if (oneLine.length <= MAX_ALERT_LENGTH) return oneLine;
  const clipped = oneLine.slice(0, MAX_ALERT_LENGTH);
  const lastStop = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "));
  if (lastStop > 60) return clipped.slice(0, lastStop + 1);
  return `${clipped.slice(0, clipped.lastIndexOf(" "))}…`;
}

export function buildTrendPrompt(
  firstName: string,
  checkpointLabel: string,
  comparison: FeedingComparison,
): { system: string; user: string } {
  const { today, baseline, feedsChange, volumeChange } = comparison;

  const facts = [
    `Baby: ${firstName}`,
    `Time of day: ${checkpointLabel}`,
    `Feeds so far today: ${today.feeds}`,
    `Feeds by ${checkpointLabel} on an average day last week: ${round1(baseline.feeds)} (over ${baseline.days} days with data)`,
    feedsChange != null
      ? `Feed count is ${feedsChange < 0 ? `${pctBelow(feedsChange)} below` : `${pctBelow(feedsChange)} above`} that average`
      : "Feed count has no average to compare against",
    today.volumeOz != null
      ? `Volume so far today: ${round1(today.volumeOz)} oz`
      : "Volume so far today: not measured (nothing logged with an amount)",
    baseline.volumeOz != null
      ? `Volume by ${checkpointLabel} on an average day last week: ${round1(baseline.volumeOz)} oz`
      : "Volume last week: not measured",
    volumeChange != null
      ? `Volume is ${volumeChange < 0 ? `${pctBelow(volumeChange)} below` : `${pctBelow(volumeChange)} above`} that average`
      : "Volume has no average to compare against",
  ].join("\n");

  return {
    system: [
      "You review one baby's feeding so far today against their own average over the previous week, at a fixed point in the day, for a baby-tracking app.",
      "The figures below have already been checked and do show a shortfall. Your job is to decide whether it is big enough to be worth interrupting the parents' day with a phone notification, and if so to write that notification.",
      'Reply with one JSON object and nothing else, in exactly this shape: {"alert": true, "message": "..."}',
      "Set alert to false when the gap is small, easily explained by a late start to the day, or otherwise not worth a buzz. Set it to true when a parent would genuinely want to know now.",
      "message: a single sentence under 140 characters, naming the baby and the actual figures given. Plain, calm and factual — this arrives on a lock screen, not in a conversation.",
      "Use only the numbers provided. Never invent, recompute or round them differently.",
      "Never give medical, dietary or developmental advice, never suggest anything is wrong with the baby, and never tell the parent what to do about it. You are not a doctor and this is not a diagnosis.",
      "No emoji, no hashtags, no exclamation marks, no greeting, no sign-off.",
    ].join(" "),
    user: `${facts}\n\nReply with the JSON object.`,
  };
}

interface AiTextResponse {
  response?: string;
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: {
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

function extractModelText(result: AiTextResponse): string {
  return result.response ?? result.choices?.[0]?.message?.content ?? "";
}

/** A one-line, log-safe description of a reply that wasn't usable — metadata
 *  only, never the text, which is about somebody's child. Same shape as
 *  `describeReply` in dailyNote.ts, and there for the same reason: this
 *  failure mode is otherwise invisible from outside the account. */
function describeReply(result: AiTextResponse): string {
  const bits = [`keys=${Object.keys(result ?? {}).join("|") || "none"}`];
  const finish = result.choices?.[0]?.finish_reason;
  if (finish) bits.push(`finish=${finish}`);
  if (result.usage?.completion_tokens !== undefined) bits.push(`out=${result.usage.completion_tokens}`);
  const reasoning = result.usage?.completion_tokens_details?.reasoning_tokens;
  if (reasoning !== undefined) bits.push(`reasoning=${reasoning}`);
  return bits.join(" ");
}

/**
 * Pull `{ alert, message }` out of a model reply. Tolerates the two things
 * every model does to JSON it was asked for bare: wrapping it in a ```json
 * fence, and saying a sentence either side of it.
 */
export function parseAnalysis(raw: string): { alert: boolean; message: string } | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const { alert, message } = parsed as { alert?: unknown; message?: unknown };
  if (typeof alert !== "boolean") return null;
  // A "no alert" answer needs no message; a "yes" without a usable one is not
  // an answer at all, and falls through to the template.
  if (!alert) return { alert: false, message: "" };
  if (typeof message !== "string") return null;
  const tidied = tidyAlert(message);
  return tidied ? { alert: true, message: tidied } : null;
}

export interface TrendAnalysis {
  alert: boolean;
  body: string;
  source: "ai" | "fallback";
  /** Why the model's answer wasn't used, when it wasn't. */
  reason?: string;
}

/**
 * Ask the model whether this shortfall is worth a notification, and for the
 * sentence to send.
 *
 * Only ever called when `compareFeeding` has already found a shortfall, so
 * every path out of here that isn't a clear "no" from the model keeps the
 * alert: a missing binding, a model error, a rate limit, or a reply that isn't
 * the JSON we asked for all fall through to the template sentence with
 * `alert: true` intact.
 */
export async function analyzeTrend(
  env: Env,
  firstName: string,
  checkpointLabel: string,
  comparison: FeedingComparison,
): Promise<TrendAnalysis> {
  const fallbackBody = fallbackAlert(firstName, checkpointLabel, comparison);
  const fallbackWith = (reason: string): TrendAnalysis => ({
    alert: true,
    body: fallbackBody,
    source: "fallback",
    reason,
  });
  if (!env.AI) return fallbackWith("no AI binding");

  const { system, user } = buildTrendPrompt(firstName, checkpointLabel, comparison);
  // An explicit override replaces the chain entirely — if someone names a
  // model, that is the model they want, not a first preference.
  const models = env.FEEDING_TREND_MODEL ? [env.FEEDING_TREND_MODEL] : TREND_MODEL_CHAIN;
  const failures: string[] = [];

  for (const model of models) {
    try {
      const result = (await env.AI.run(model, {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: MAX_REPLY_TOKENS,
        // Low: this is a judgement and a restatement of given figures, not
        // creative writing. The daily note wants warmth; this wants the same
        // numbers said the same way every time.
        temperature: 0.2,
      })) as AiTextResponse;

      const analysis = parseAnalysis(extractModelText(result));
      if (analysis) {
        const reason = failures.length > 0 ? `answered with ${model} after: ${failures.join("; ")}` : undefined;
        return analysis.alert
          ? { alert: true, body: analysis.message, source: "ai", reason }
          : { alert: false, body: fallbackBody, source: "ai", reason };
      }
      failures.push(`${model}: unusable reply — ${describeReply(result)}`);
    } catch (error) {
      failures.push(`${model}: threw ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return fallbackWith(failures.join("; "));
}

// ── Running a check ──────────────────────────────────────────────────────────

/**
 * Claim this (child, day, checkpoint) before anything is sent.
 *
 * Returns false when the row already existed, which means this checkpoint has
 * already been decided — a cron that fires twice for the same ET hour (a
 * retry, or the EST and EDT UTC hours colliding around a clock change) must
 * not push the same alert twice. Claimed here rather than after sending for
 * the same reason `reminders.ts` marks a gap handled at enqueue time: a slow
 * delivery must not open the door to a second round.
 */
async function claimCheckpoint(
  env: Env,
  childId: number,
  checkDate: string,
  checkpoint: number,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `INSERT INTO feeding_trend_checks (child_id, check_date, checkpoint)
     VALUES (?, ?, ?)
     ON CONFLICT (child_id, check_date, checkpoint) DO NOTHING`,
  )
    .bind(childId, checkDate, checkpoint)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** Record what the check decided, on the row already claimed above. */
async function recordCheck(
  env: Env,
  childId: number,
  checkDate: string,
  checkpoint: number,
  alerted: boolean,
  body: string,
  source: "ai" | "fallback",
): Promise<void> {
  await env.DB.prepare(
    `UPDATE feeding_trend_checks
        SET alerted = ?, body = ?, source = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE child_id = ? AND check_date = ? AND checkpoint = ?`,
  )
    .bind(alerted ? 1 : 0, body, source, childId, checkDate, checkpoint)
    .run();
}

/** Queue (or, with no queue bound, send inline) one push per device
 *  subscribed to this child. Returns how many devices were reached. */
async function fanOutAlert(env: Env, childId: number, childName: string, body: string): Promise<number> {
  const subscriptions = await env.DB.prepare(
    `SELECT ps.id FROM push_subscriptions ps
     JOIN user_children uc ON uc.user_id = ps.user_id
     WHERE uc.child_id = ?`,
  )
    .bind(childId)
    .all<{ id: number }>();

  let sent = 0;
  for (const sub of subscriptions.results) {
    const job: FeedingTrendJob = { subscriptionId: sub.id, childName, body };
    try {
      if (env.FEEDING_TREND_QUEUE) await env.FEEDING_TREND_QUEUE.send(job);
      else await deliverFeedingTrendAlert(env, job);
      sent++;
    } catch (error) {
      console.error(`Failed to queue the feeding trend alert for subscription ${sub.id}:`, error);
    }
  }
  return sent;
}

export interface RunOptions {
  /** The instant being checked. */
  now?: Date;
  /**
   * Actually claim the checkpoint and push. False runs the whole analysis —
   * figures, model and all — and returns it without notifying anyone or
   * consuming the checkpoint, which is what the manual route defaults to.
   */
  send?: boolean;
}

/**
 * Check every child at one checkpoint: figures, comparison, model, push.
 *
 * The cron's whole path, and the manual route's. Unlike the daily note this
 * does the model call inline rather than on the queue — see the note at the
 * top of this file about why a retried analysis is worth less than a prompt
 * template one.
 */
export async function runFeedingTrendCheck(
  env: Env,
  options: RunOptions = {},
): Promise<FeedingTrendCheck[]> {
  const now = options.now ?? new Date();
  const send = options.send ?? false;
  const windows = buildTrendWindows(now);
  const checkpoint = etHour(now);
  const checkpointLabel = hourLabel(checkpoint);

  const { results: children } = await env.DB.prepare(
    "SELECT id, first_name FROM children ORDER BY id",
  ).all<ChildRow>();

  const checks: FeedingTrendCheck[] = [];

  for (const child of children) {
    const base = {
      childId: child.id,
      firstName: child.first_name,
      checkDate: windows.checkDate,
      checkpoint,
      checkpointLabel,
    };

    try {
      // Seven independent reads — awaiting them in sequence would make every
      // check seven round trips deep for no reason.
      const [today, baselineDays] = await Promise.all([
        fetchFeedingWindow(env, child.id, windows.todayStart, windows.todayEnd),
        Promise.all(
          windows.baseline.map((w) => fetchFeedingWindow(env, child.id, w.start, w.end)),
        ),
      ]);

      const comparison = compareFeeding(today, baselineDays);

      if (!comparison.below) {
        checks.push({
          ...base,
          comparison,
          body: null,
          source: null,
          alerted: false,
          skipped: comparison.reason === "no-baseline" ? "no-baseline" : "on-track",
        });
        continue;
      }

      // Claimed before the model is asked: the checkpoint is spent either way,
      // and a second cron firing while the first is still waiting on inference
      // is exactly the double-push this guards against.
      if (send && !(await claimCheckpoint(env, child.id, windows.checkDate, checkpoint))) {
        checks.push({
          ...base,
          comparison,
          body: null,
          source: null,
          alerted: false,
          skipped: "already-checked",
        });
        continue;
      }

      const analysis = await analyzeTrend(env, child.first_name, checkpointLabel, comparison);

      if (analysis.reason) {
        console.warn(
          `Feeding trend analysis for child ${child.id} at ${checkpointLabel} — ${analysis.reason}`,
        );
      }

      if (!send) {
        checks.push({
          ...base,
          comparison,
          body: analysis.body,
          source: analysis.source,
          alerted: false,
          skipped: analysis.alert ? "preview" : "model-declined",
          reason: analysis.reason,
        });
        continue;
      }

      if (!analysis.alert) {
        await recordCheck(env, child.id, windows.checkDate, checkpoint, false, analysis.body, analysis.source);
        checks.push({
          ...base,
          comparison,
          body: analysis.body,
          source: analysis.source,
          alerted: false,
          skipped: "model-declined",
          reason: analysis.reason,
        });
        continue;
      }

      const devices = await fanOutAlert(env, child.id, child.first_name, analysis.body);
      await recordCheck(
        env,
        child.id,
        windows.checkDate,
        checkpoint,
        devices > 0,
        analysis.body,
        analysis.source,
      );
      checks.push({
        ...base,
        comparison,
        body: analysis.body,
        source: analysis.source,
        alerted: devices > 0,
        skipped: devices > 0 ? undefined : "no-subscribers",
        reason: analysis.reason,
      });
    } catch (error) {
      // One child's check failing must not cost the others theirs.
      console.error(`Feeding trend check failed for child ${child.id}:`, error);
    }
  }

  return checks;
}

/**
 * The cron's entry point. Runs the check only at the three ET checkpoints —
 * the cron fires at six UTC hours so that three of them land on 11am, 4pm and
 * 7pm Eastern whichever side of daylight saving the year is on, and this
 * throws away the other three. See FEEDING_TREND_CRON in index.ts.
 */
export async function runFeedingTrendCron(env: Env, now = new Date()): Promise<FeedingTrendCheck[]> {
  if (checkpointFor(now) == null) return [];
  return runFeedingTrendCheck(env, { now, send: true });
}

/** Sends one alert push for one job; run from the queue consumer. */
export async function deliverFeedingTrendAlert(env: Env, job: FeedingTrendJob): Promise<void> {
  const sub = await env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE id = ?")
    .bind(job.subscriptionId)
    .first<{ endpoint: string; p256dh: string; auth: string }>();

  // Unsubscribed between enqueue and delivery — nothing to do.
  if (!sub) return;

  await sendPushMessage(env, sub, {
    title: "Baby Tracker",
    body: job.body,
    url: "/",
  });
}
