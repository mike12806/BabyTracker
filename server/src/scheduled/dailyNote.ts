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
 * while writing markedly better than an 8B, and it is not a reasoning model —
 * nothing here benefits from a thinking trace we would only have to strip.
 *
 * Note the exact slug: Cloudflare's prose sometimes shortens these, but this
 * is the form the model catalog and pricing table use. Getting it wrong is a
 * quiet failure — every call throws, every note falls back to the template,
 * and the card keeps working — so `refreshDailyNotes` logs loudly when a whole
 * run falls back despite a binding being present.
 */
export const DEFAULT_NOTE_MODEL = "@cf/google/gemma-4-26b-a4b-it";

/** The card gives this one line; anything longer gets clipped on a phone. */
export const MAX_NOTE_LENGTH = 240;

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

interface AiTextResponse {
  response?: string;
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
): Promise<{ body: string; source: "ai" | "fallback" }> {
  const fallback = { body: fallbackNote(firstName, day, trends), source: "fallback" as const };
  if (!env.AI) return fallback;

  const { system, user } = buildPrompt(firstName, ageLabel, day, trends);
  try {
    const result = (await env.AI.run(env.DAILY_NOTE_MODEL || DEFAULT_NOTE_MODEL, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      // Two sentences. The cap is a cost floor as much as a length limit.
      max_tokens: 120,
      temperature: 0.7,
    })) as AiTextResponse;

    const tidied = tidyNote(result?.response ?? "");
    return tidied ? { body: tidied, source: "ai" } : fallback;
  } catch (error) {
    console.error(`Daily note generation failed for ${firstName}:`, error);
    return fallback;
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
 * The unit the note speaks in. The blurb is one row shared by everyone who
 * reads it, so it cannot be per-user like the email is — take the unit most of
 * the household has chosen and let the minority read a converted number.
 */
async function householdUnit(env: Env): Promise<VolumeUnit> {
  const row = await env.DB.prepare(
    `SELECT volume_unit FROM user_settings
     WHERE volume_unit IN ('ml', 'oz', 'cc')
     GROUP BY volume_unit ORDER BY COUNT(*) DESC, volume_unit LIMIT 1`,
  ).first<{ volume_unit: VolumeUnit }>();
  return row?.volume_unit ?? "ml";
}

/**
 * Write today's note for every child. Called once a day from the cron, beside
 * the summary email, and safe to run again — the unique index on
 * (child_id, note_date) turns a second run into an update.
 */
export async function refreshDailyNotes(env: Env, now = new Date()): Promise<DailyNote[]> {
  const { windowStart, windowEnd } = computeDailyWindow(now);
  const noteDate = windowStart.slice(0, 10);
  const unit = await householdUnit(env);

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
      const { body, source } = await generateNoteBody(
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

      written.push({ child_id: child.id, note_date: noteDate, body, source });
    } catch (error) {
      // One child's note failing must not cost the others theirs.
      console.error(`Failed to write the daily note for child ${child.id}:`, error);
    }
  }

  // A wrong model slug, a revoked binding, or a model retired out from under us
  // all look identical from the card: the note still appears, just written by
  // the template. Nothing else would ever surface that, so say it plainly.
  if (env.AI && written.length > 0 && written.every((n) => n.source === "fallback")) {
    console.warn(
      `Every daily note fell back to the template despite an AI binding — check that ` +
        `"${env.DAILY_NOTE_MODEL || DEFAULT_NOTE_MODEL}" is a valid Workers AI model.`,
    );
  }

  return written;
}
