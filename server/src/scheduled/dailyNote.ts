/**
 * The short blurb at the top of the dashboard: how yesterday went for one
 * child, how that compares to their own last week, and a line of encouragement
 * for whoever is reading it at 6am.
 *
 * Two rules shape the whole file:
 *
 * 1. **The numbers are computed here, never by the model.** An LLM asked to do
 *    arithmetic on feed counts will occasionally get it wrong, and a blurb that
 *    misreports how much a baby ate is worse than no blurb at all. The model is
 *    handed finished figures and asked only to write the sentence around them.
 * 2. **One generation per child per day, from the cron.** Reads come from the
 *    cached row in D1, so opening the app never costs an inference.
 */

import type { Env } from "../types/env.js";
import { computeDailyWindow, volumeTotal, type AmountRow, type VolumeUnit } from "./dailySummary.js";

/**
 * The model that writes the note.
 *
 * Picked on writing quality, not price. At one generation per child per day
 * (~350 input tokens, ~55 out) every plausible candidate on Workers AI costs
 * between one and ten cents a *year* and uses well under 1% of the 10,000
 * Neuron daily free allocation — so cost cannot sensibly decide this, and an
 * 8B model is exactly where warm two-sentence prose turns into "Great job,
 * keep it up!". Gemma 4 26B is an MoE (4B active), so it is fast and cheap
 * while writing markedly better than an 8B.
 *
 * It does have "thinking mode" — despite an earlier version of this comment
 * claiming otherwise — but that is handled, not avoided: Workers AI answers
 * models like this one in the OpenAI chat-completions shape, with the
 * finished reply in `choices[0].message.content` and any reasoning trace
 * already separated into `.reasoning_content` beside it. `extractModelText`
 * below reads `.content` (falling back to the older `.response` shape for
 * simpler models), so nothing here needed to strip a trace by hand — it just
 * needed to read the right field, which the first version of this file
 * didn't: it only ever read `.response`, which this model never sets, so
 * every note fell back to the template from the day this shipped until that
 * was noticed and fixed.
 *
 * Note the exact slug: Cloudflare's prose sometimes shortens these, but this
 * is the form the model catalog and pricing table use. Getting it wrong is a
 * quiet failure — every call throws, every note falls back to the template,
 * and the card keeps working — so `refreshDailyNotes` logs loudly when a whole
 * run falls back despite a binding being present. That warning covers the
 * `.response`-vs-`.choices` bug above too — it doesn't care why every note
 * fell back, only that they all did — so it should have been visible in
 * Workers Logs from the first cron run after this shipped, if anyone had
 * gone looking.
 */
export const DEFAULT_NOTE_MODEL = "@cf/google/gemma-4-26b-a4b-it";

/** The card gives this one line; anything longer gets clipped on a phone. */
export const MAX_NOTE_LENGTH = 240;

/**
 * Token budget for the model's reply — generous, because the default model
 * thinks before it answers.
 *
 * This was 120, chosen for "two sentences" as if the whole budget went to the
 * visible answer. On a thinking model it does not: reasoning tokens come out
 * of the same allowance, so the model spent all 120 working out what to say
 * and returned an empty (or truncated) `content` with `finish_reason:
 * "length"`. No exception, so it looked like a working call that produced
 * nothing, and every note silently fell back to the template — the second
 * cause of the same visible symptom, after the `.response`/`.choices` mixup
 * above.
 *
 * Being generous here costs nothing worth counting. Billing is on tokens
 * actually produced, not the ceiling, and at one call per child per day even
 * a full 1,000-token reply is a fraction of a cent a year. `tidyNote` still
 * clips what gets *stored* to MAX_NOTE_LENGTH, so a rambling model can't
 * stretch the card either way.
 */
export const MAX_REPLY_TOKENS = 1000;

/** Days of history the "trending" comparison averages over. */
const BASELINE_DAYS = 7;

/** Below this, a day-over-baseline difference is noise, not a trend. */
const TREND_THRESHOLD = 0.15;

export interface DayStats {
  feeds: number;
  feedVolume: { value: number; unit: string } | null;
  diapers: number;
  sleepMinutes: number;
  longestSleepMinutes: number;
  sleepSessions: number;
  tummyMinutes: number;
}

export interface DailyNote {
  child_id: number;
  note_date: string;
  body: string;
  source: "ai" | "fallback";
  /** Why the model's reply wasn't used, when it wasn't. Absent on success.
   *  Returned to the caller and logged, but not stored — it describes this
   *  run, not the note. */
  reason?: string;
}

/** One generation attempt: the text to store, whether the model wrote it, and
 *  — when it didn't — why not. */
export interface NoteGeneration {
  body: string;
  source: "ai" | "fallback";
  reason?: string;
}

interface ChildRow {
  id: number;
  first_name: string;
  birth_date: string;
}

interface WindowRow {
  start_time: string;
  end_time: string | null;
}

/** Minutes of a session that fall inside [start, end) — a nap that runs through
 *  midnight belongs to both days, in the proportion it was actually asleep. */
function clippedMinutes(row: WindowRow, start: string, end: string): number {
  const from = Math.max(new Date(row.start_time).getTime(), new Date(start).getTime());
  const until = Math.min(
    row.end_time ? new Date(row.end_time).getTime() : new Date(end).getTime(),
    new Date(end).getTime(),
  );
  return Math.max(0, (until - from) / 60000);
}

export async function fetchDayStats(
  env: Env,
  childId: number,
  start: string,
  end: string,
  unit: VolumeUnit,
): Promise<DayStats> {
  const [feedings, diapers, sleepSessions, tummyTimes] = await Promise.all([
    env.DB.prepare(
      "SELECT amount, amount_unit FROM feedings WHERE child_id = ? AND start_time >= ? AND start_time < ?",
    ).bind(childId, start, end).all<AmountRow>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM diaper_changes WHERE child_id = ? AND time >= ? AND time < ?",
    ).bind(childId, start, end).first<{ n: number }>(),
    env.DB.prepare(
      "SELECT start_time, end_time FROM sleep WHERE child_id = ? AND start_time < ? AND (end_time IS NULL OR end_time > ?)",
    ).bind(childId, end, start).all<WindowRow>(),
    env.DB.prepare(
      "SELECT start_time, end_time FROM tummy_time WHERE child_id = ? AND start_time < ? AND (end_time IS NULL OR end_time > ?)",
    ).bind(childId, end, start).all<WindowRow>(),
  ]);

  const sleepMins = sleepSessions.results.map((s) => clippedMinutes(s, start, end));

  return {
    feeds: feedings.results.length,
    feedVolume: volumeTotal(feedings.results, unit),
    diapers: diapers?.n ?? 0,
    sleepMinutes: Math.round(sleepMins.reduce((a, b) => a + b, 0)),
    longestSleepMinutes: Math.round(sleepMins.length > 0 ? Math.max(...sleepMins) : 0),
    sleepSessions: sleepMins.filter((m) => m > 0).length,
    tummyMinutes: Math.round(
      tummyTimes.results.reduce((sum, t) => sum + clippedMinutes(t, start, end), 0),
    ),
  };
}

export type Direction = "up" | "down" | "steady";

export interface Trend {
  metric: string;
  direction: Direction;
  /** Human-readable, already rounded — e.g. "6 feeds vs 4.5 a day last week". */
  phrase: string;
}

function direction(value: number, baseline: number): Direction {
  if (baseline <= 0) return "steady";
  const change = (value - baseline) / baseline;
  if (change > TREND_THRESHOLD) return "up";
  if (change < -TREND_THRESHOLD) return "down";
  return "steady";
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function hoursLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Yesterday against the child's own previous week — the only baseline worth
 * comparing a baby to. Metrics with no history yet are simply left out.
 */
export function buildTrends(day: DayStats, baseline: DayStats[]): Trend[] {
  if (baseline.length === 0) return [];
  const mean = (pick: (s: DayStats) => number) =>
    baseline.reduce((sum, s) => sum + pick(s), 0) / baseline.length;

  const trends: Trend[] = [];

  const avgFeeds = mean((s) => s.feeds);
  if (avgFeeds > 0 || day.feeds > 0) {
    trends.push({
      metric: "feeds",
      direction: direction(day.feeds, avgFeeds),
      phrase: `${day.feeds} feeds, against ${round1(avgFeeds)} a day over the last week`,
    });
  }

  const avgSleep = mean((s) => s.sleepMinutes);
  if (avgSleep > 0 || day.sleepMinutes > 0) {
    trends.push({
      metric: "sleep",
      direction: direction(day.sleepMinutes, avgSleep),
      phrase: `${hoursLabel(day.sleepMinutes)} of sleep, against ${hoursLabel(avgSleep)} a day over the last week`,
    });
  }

  const avgLongest = mean((s) => s.longestSleepMinutes);
  if (day.longestSleepMinutes > 0) {
    trends.push({
      metric: "longest stretch",
      direction: direction(day.longestSleepMinutes, avgLongest),
      phrase: `longest stretch ${hoursLabel(day.longestSleepMinutes)}, against ${hoursLabel(avgLongest)} usually`,
    });
  }

  const avgDiapers = mean((s) => s.diapers);
  if (avgDiapers > 0 || day.diapers > 0) {
    trends.push({
      metric: "diapers",
      direction: direction(day.diapers, avgDiapers),
      phrase: `${day.diapers} diapers, against ${round1(avgDiapers)} a day over the last week`,
    });
  }

  return trends;
}

/**
 * The blurb when there is no model to write one — and the reason the card can
 * be relied on. It says the same true things, just in a fixed voice.
 */
export function fallbackNote(firstName: string, day: DayStats, trends: Trend[]): string {
  if (day.feeds === 0 && day.diapers === 0 && day.sleepMinutes === 0) {
    return `Nothing logged for ${firstName} yesterday — a quiet page is fine too. Today's a fresh one.`;
  }

  const parts: string[] = [];
  if (day.feeds > 0) {
    parts.push(
      day.feedVolume
        ? `${day.feeds} feeds (${round1(day.feedVolume.value)} ${day.feedVolume.unit})`
        : `${day.feeds} feeds`,
    );
  }
  if (day.sleepMinutes > 0) parts.push(`${hoursLabel(day.sleepMinutes)} of sleep`);
  if (day.diapers > 0) parts.push(`${day.diapers} diapers`);
  if (day.tummyMinutes > 0) parts.push(`${hoursLabel(day.tummyMinutes)} of tummy time`);

  const sleepTrend = trends.find((t) => t.metric === "longest stretch" || t.metric === "sleep");
  const tail =
    sleepTrend?.direction === "up"
      ? "Sleep is trending up — you've earned that."
      : sleepTrend?.direction === "down"
        ? "A shorter night than usual. You still showed up for all of it."
        : "Steady as they come. You're doing this well.";

  return `${firstName} had ${parts.join(", ")} yesterday. ${tail}`;
}

/** Model output is text from a machine, not a trusted string: one line, no
 *  wrapping quotes, no runaway length, and empty means "use the fallback". */
export function tidyNote(raw: string): string | null {
  const oneLine = raw.replace(/\s+/g, " ").trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (oneLine.length < 20) return null;
  if (oneLine.length <= MAX_NOTE_LENGTH) return oneLine;
  // Clip at the last sentence that fits, rather than mid-word.
  const clipped = oneLine.slice(0, MAX_NOTE_LENGTH);
  const lastStop = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "));
  if (lastStop > 60) return clipped.slice(0, lastStop + 1);
  return `${clipped.slice(0, clipped.lastIndexOf(" "))}…`;
}

export function buildPrompt(
  firstName: string,
  ageLabel: string,
  day: DayStats,
  trends: Trend[],
): { system: string; user: string } {
  const facts = [
    `Baby: ${firstName}, ${ageLabel}`,
    `Feeds yesterday: ${day.feeds}${day.feedVolume ? ` (${round1(day.feedVolume.value)} ${day.feedVolume.unit} total)` : ""}`,
    `Sleep yesterday: ${hoursLabel(day.sleepMinutes)} across ${day.sleepSessions} sessions, longest ${hoursLabel(day.longestSleepMinutes)}`,
    `Diapers yesterday: ${day.diapers}`,
    `Tummy time yesterday: ${hoursLabel(day.tummyMinutes)}`,
    ...trends.map((t) => `Trend (${t.metric}, ${t.direction}): ${t.phrase}`),
  ].join("\n");

  return {
    system: [
      "You write one short daily note for a baby-tracking app, read by the baby's parents over their morning coffee.",
      "Write exactly two sentences, under 220 characters total.",
      "First sentence: how yesterday went, using the figures given. Second sentence: one honest, specific line of encouragement for the parents.",
      "Use only the numbers provided — never invent, recompute, or round them differently.",
      "Warm and plain-spoken. No emoji, no hashtags, no exclamation stacking, no greeting, no sign-off, no quotation marks around the note.",
      "Never give medical, dietary, or developmental advice, and never suggest anything is wrong with the baby. You are not a doctor and this is not a diagnosis.",
      "If the figures are all zero, say the day went unlogged without implying neglect.",
    ].join(" "),
    user: `${facts}\n\nWrite the note.`,
  };
}

/**
 * Workers AI does not return one response shape. Simpler text-generation
 * models answer `{ response: string }`; models with function calling or a
 * "thinking mode" — including the default model here, `gemma-4-26b-a4b-it` —
 * answer in the OpenAI chat-completions shape instead, `{ choices: [{
 * message: { content, reasoning_content? } }] }`, with the reasoning trace
 * (if any) already separated out into `reasoning_content` and the finished
 * answer in `content`. Reading only `.response` from a model that actually
 * returns `.choices` finds nothing, `tidyNote` correctly calls that "no
 * usable reply", and every note falls back to the template — silently
 * correct in its own terms, silently wrong about why.
 */
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

/**
 * A one-line, log-safe description of what the model actually sent back, for
 * when it sent back nothing usable.
 *
 * This exists because this feature has now failed twice in the same shape —
 * the call succeeds, the reply is unusable for some reason invisible from
 * outside, and every note quietly becomes a template one. Guessing at the
 * cause from the outside cost two deploys. The reply's own metadata says
 * which of `finish=length` (ran out of budget mid-thought), `reasoning=<n>`
 * (spent the budget thinking) or an unexpected `keys=` set (a third response
 * shape) actually happened, so the next failure names itself.
 *
 * Metadata only — never the reply text, which is about somebody's child.
 */
function describeReply(result: AiTextResponse): string {
  const bits = [`keys=${Object.keys(result ?? {}).join("|") || "none"}`];
  const finish = result.choices?.[0]?.finish_reason;
  if (finish) bits.push(`finish=${finish}`);
  if (result.usage?.completion_tokens !== undefined) {
    bits.push(`out=${result.usage.completion_tokens}`);
  }
  const reasoning = result.usage?.completion_tokens_details?.reasoning_tokens;
  if (reasoning !== undefined) bits.push(`reasoning=${reasoning}`);
  return bits.join(" ");
}

/**
 * Ask the model for the blurb, and fall back to the template on anything that
 * goes wrong — a missing binding (local dev and the tests have none), a model
 * error, a rate limit, or a reply that does not survive `tidyNote`.
 */
export async function generateNoteBody(
  env: Env,
  firstName: string,
  ageLabel: string,
  day: DayStats,
  trends: Trend[],
): Promise<NoteGeneration> {
  const fallbackBody = fallbackNote(firstName, day, trends);
  const fallbackWith = (reason: string): NoteGeneration => ({
    body: fallbackBody,
    source: "fallback",
    reason,
  });
  if (!env.AI) return fallbackWith("no AI binding");

  const { system, user } = buildPrompt(firstName, ageLabel, day, trends);
  try {
    const result = (await env.AI.run(env.DAILY_NOTE_MODEL || DEFAULT_NOTE_MODEL, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: MAX_REPLY_TOKENS,
      temperature: 0.7,
    })) as AiTextResponse;

    const text = extractModelText(result);
    const tidied = tidyNote(text);
    if (tidied) return { body: tidied, source: "ai" };
    return fallbackWith(`unusable reply (${text.length} chars) — ${describeReply(result)}`);
  } catch (error) {
    return fallbackWith(
      `model call threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Whole months old, phrased the way a parent would say it. */
export function ageLabel(birthDate: string, on: Date): string {
  const birth = new Date(`${birthDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return "a newborn";
  const days = Math.floor((on.getTime() - birth.getTime()) / 86400000);
  if (days < 0) return "not born yet";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} old`;
  if (days < 61) return `${Math.floor(days / 7)} weeks old`;
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months} months old`;
  return `${Math.floor(months / 12)} years old`;
}

/**
 * The unit the note speaks in. Fixed at oz rather than following each
 * reader's own display setting (unlike the dashboard totals, or the daily
 * summary email, which is per-user): the note is one row shared by everyone
 * who reads it, so it cannot actually be per-user, and oz is what gets said
 * out loud in this household regardless of what any one person's toggle is
 * set to.
 */
const NOTE_VOLUME_UNIT: VolumeUnit = "oz";

/**
 * Write today's note for every child. Called once a day from the cron, beside
 * the summary email, and safe to run again — the unique index on
 * (child_id, note_date) turns a second run into an update.
 */
export async function refreshDailyNotes(env: Env, now = new Date()): Promise<DailyNote[]> {
  const { windowStart, windowEnd } = computeDailyWindow(now);
  const noteDate = windowStart.slice(0, 10);
  const unit = NOTE_VOLUME_UNIT;

  const { results: children } = await env.DB.prepare(
    "SELECT id, first_name, birth_date FROM children ORDER BY id",
  ).all<ChildRow>();

  const written: DailyNote[] = [];

  for (const child of children) {
    try {
      const day = await fetchDayStats(env, child.id, windowStart, windowEnd, unit);

      // The previous week, one day at a time, so the mean is a mean of days
      // rather than of one long lump — and so a partial history still works.
      const baseline: DayStats[] = [];
      for (let back = 1; back <= BASELINE_DAYS; back++) {
        const start = new Date(new Date(windowStart).getTime() - back * 86400000).toISOString();
        const end = new Date(new Date(windowEnd).getTime() - back * 86400000).toISOString();
        baseline.push(await fetchDayStats(env, child.id, start, end, unit));
      }

      const trends = buildTrends(day, baseline);
      const { body, source, reason } = await generateNoteBody(
        env,
        child.first_name,
        ageLabel(child.birth_date, new Date(windowStart)),
        day,
        trends,
      );

      await env.DB.prepare(
        `INSERT INTO child_daily_notes (child_id, note_date, body, source)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(child_id, note_date) DO UPDATE SET
           body = excluded.body,
           source = excluded.source,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
      ).bind(child.id, noteDate, body, source).run();

      // Only worth saying when a model was supposed to answer. Running
      // without a binding is a normal configuration (local dev, tests), not
      // something to warn about on every child, every day.
      if (reason && env.AI) {
        console.warn(`Daily note for child ${child.id} fell back — ${reason}`);
      }
      written.push({ child_id: child.id, note_date: noteDate, body, source, reason });
    } catch (error) {
      // One child's note failing must not cost the others theirs.
      console.error(`Failed to write the daily note for child ${child.id}:`, error);
    }
  }

  // A wrong model slug, a revoked binding, a model retired out from under us,
  // an exhausted token budget — all identical from the card, which still shows
  // a note, just a template one. Nothing else would ever surface that, so say
  // it plainly, and say which reasons came back rather than making the next
  // person guess (this has been guessed wrong twice).
  if (env.AI && written.length > 0 && written.every((n) => n.source === "fallback")) {
    const reasons = [...new Set(written.map((n) => n.reason).filter(Boolean))];
    console.warn(
      `Every daily note fell back to the template despite an AI binding ` +
        `(model "${env.DAILY_NOTE_MODEL || DEFAULT_NOTE_MODEL}"): ${reasons.join("; ")}`,
    );
  }

  return written;
}
