/**
 * Keeps the "boop" line pool (see the migration comment on `boop_lines`)
 * topped up with a few new AI-written lines every so often, in the same
 * voice as the ones baked into the client.
 *
 * Structured after the daily note (see dailyNote.ts) for the same reason:
 * Workers AI answers 429 / "out of capacity" often enough to plan for, and a
 * cron trigger does not re-run, so a transient failure on the cron path
 * should be retried rather than just costing that week's lines. The cron
 * enqueues one job per mood (`enqueueBoopLineRefresh`) and the consumer in
 * index.ts does the actual generation, retrying on failure like the daily
 * note queue does. Simpler than that queue in two ways the boop pool can
 * afford: no per-row "fallback" content (a line the model didn't write just
 * isn't added — there's nothing to store in its place, unlike a note the
 * card must always show something for), and no dead letter queue (same
 * reasoning as NOTE_QUEUE — a mood that exhausts its retries just keeps
 * whatever lines it already had, which is a fine outcome for something this
 * low-stakes).
 */

import type { Env } from "../types/env.js";

export type BoopMood = "day" | "night";

/** Queue carrying one line-generation job per mood. */
export const BOOP_LINES_QUEUE = "baby-tracker-boop-lines";

/** One mood's refresh job, as it travels through the queue. */
export interface BoopLineJob {
  mood: BoopMood;
}

/**
 * Same model as the daily note (see DEFAULT_NOTE_MODEL in dailyNote.ts for
 * why): fast, cheap, and already proven to write in a warm, brief voice on
 * this account. A second, older model backs it up for the same reason —
 * different response shape, different failure modes, unlikely to be down for
 * the same reason at the same time.
 */
export const DEFAULT_BOOP_LINE_MODEL = "@cf/google/gemma-4-26b-a4b-it";
export const BOOP_LINE_MODEL_CHAIN = [
  DEFAULT_BOOP_LINE_MODEL,
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
];

/** New lines asked for, per mood, per run. Modest on purpose — this tops up
 *  a pool, it doesn't need to repopulate it in one go. */
export const LINES_PER_RUN = 4;

/** Lines kept per mood. Beyond this, the oldest are pruned after each run so
 *  the pool keeps turning over rather than growing forever. */
export const POOL_CAP_PER_MOOD = 30;

/** A boop line is a caption, not a sentence — reject anything that reads like
 *  the model ignored the brief. */
const MAX_LINE_LENGTH = 60;
const MIN_LINE_LENGTH = 2;

interface AiTextResponse {
  response?: string;
  choices?: { message?: { content?: string } }[];
}

function extractModelText(result: AiTextResponse): string {
  return result.response ?? result.choices?.[0]?.message?.content ?? "";
}

/** One candidate line, cleaned up and validated, or `null` if it isn't
 *  usable — a model reply this short is one bad line, not one bad run, so
 *  the caller just drops it rather than falling back to anything. */
export function tidyBoopLine(raw: string): string | null {
  const oneLine = raw
    .replace(/^[\s"'“”\-*•\d.)]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
  if (oneLine.length < MIN_LINE_LENGTH || oneLine.length > MAX_LINE_LENGTH) return null;
  return oneLine;
}

/** Split a model's reply into candidate lines, one per line of output, tidy
 *  each, drop duplicates, and cap at `count`. */
export function parseBoopLines(raw: string, count: number): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const candidate of raw.split("\n")) {
    const tidied = tidyBoopLine(candidate);
    if (!tidied) continue;
    const key = tidied.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(tidied);
    if (lines.length >= count) break;
  }
  return lines;
}

export function buildBoopPrompt(mood: BoopMood, count: number): { system: string; user: string } {
  const voice =
    mood === "day"
      ? [
          'Existing examples, for tone only — do not repeat them: "Boop.", "Squish.", "Certified good baby.", "Boop received."',
          "The mood is playful daytime affection — a tiny, silly reward for tapping a baby's photo.",
        ]
      : [
          'Existing examples, for tone only — do not repeat them: "Boop.", "Shh. We\'re both tired.", "That\'s a 3am boop."',
          "The mood is late-night and low-key — whoever is tapping this at 3am is exhausted, not looking for energy.",
        ];

  return {
    system: [
      "You write tiny reaction captions for a baby-tracking app.",
      "They appear for a second or two when a tired parent taps their baby's photo, purely for delight.",
      `Write exactly ${count} of them, one per line, nothing else on each line.`,
      "Each line: 1 to 6 words, no numbering, no bullets, no quotation marks, no emoji.",
      "Do not use any baby's name — these are generic, shown for any child.",
      "Warm, understated, a little funny. Never medical or developmental commentary, never a question, never an instruction to the parent.",
      ...voice,
    ].join(" "),
    user: `Write ${count} new lines, one per line.`,
  };
}

/**
 * Ask the model for `count` new lines for one mood. Returns whatever usable
 * lines came back — possibly fewer than asked for, possibly none — and never
 * throws: a model outage here just means this run adds nothing.
 */
export async function generateBoopLines(
  env: Env,
  mood: BoopMood,
  count = LINES_PER_RUN,
): Promise<{ lines: string[]; reason?: string }> {
  if (!env.AI) return { lines: [], reason: "no AI binding" };

  const { system, user } = buildBoopPrompt(mood, count);
  const models = env.BOOP_LINES_MODEL ? [env.BOOP_LINES_MODEL] : BOOP_LINE_MODEL_CHAIN;
  const failures: string[] = [];

  for (const model of models) {
    try {
      const result = (await env.AI.run(model, {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 300,
        temperature: 0.9,
      })) as AiTextResponse;

      const lines = parseBoopLines(extractModelText(result), count);
      if (lines.length > 0) return { lines };
      failures.push(`${model}: no usable lines`);
    } catch (error) {
      failures.push(`${model}: threw ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { lines: [], reason: failures.join("; ") };
}

/** Add new lines for one mood, then prune back down to the pool cap. */
async function storeBoopLines(env: Env, mood: BoopMood, lines: string[]): Promise<void> {
  if (lines.length === 0) return;

  const insert = env.DB.prepare("INSERT INTO boop_lines (mood, body) VALUES (?, ?)");
  await env.DB.batch(lines.map((line) => insert.bind(mood, line)));

  // Keep only the newest POOL_CAP_PER_MOOD rows for this mood — the pool
  // should stay small and rotate, not accumulate every line ever written.
  await env.DB.prepare(
    `DELETE FROM boop_lines WHERE mood = ? AND id NOT IN (
       SELECT id FROM boop_lines WHERE mood = ? ORDER BY created_at DESC, id DESC LIMIT ?
     )`,
  ).bind(mood, mood, POOL_CAP_PER_MOOD).run();
}

export interface MoodRefreshResult {
  added: number;
  reason?: string;
}

/**
 * Generate and store a few new lines for one mood. The unit both the queue
 * consumer and the no-queue fallback below actually run.
 */
export async function refreshMood(env: Env, mood: BoopMood): Promise<MoodRefreshResult> {
  const { lines, reason } = await generateBoopLines(env, mood);
  await storeBoopLines(env, mood, lines);
  if (reason && lines.length === 0) {
    console.warn(`Boop line refresh for "${mood}" added nothing — ${reason}`);
  }
  return { added: lines.length, reason };
}

/**
 * Top up both moods' pools with a few new lines each, in this invocation —
 * no queue involved. Used by the manual refresh route (a human is waiting
 * and wants the answer now) and as the fallback for any environment without
 * the queue binding.
 *
 * Each mood is independent — a failure for one must not cost the other its
 * lines.
 */
export async function refreshBoopLines(env: Env): Promise<Record<BoopMood, MoodRefreshResult>> {
  const result = {} as Record<BoopMood, MoodRefreshResult>;

  for (const mood of ["day", "night"] as const) {
    try {
      result[mood] = await refreshMood(env, mood);
    } catch (error) {
      console.error(`Boop line refresh failed for "${mood}":`, error);
      result[mood] = { added: 0, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  return result;
}

/**
 * The cron's path: queue one refresh job per mood so a transient model
 * failure gets retried instead of costing that mood its new lines for the
 * week. Falls back to the inline path when there is no queue binding (local
 * dev, tests).
 */
export async function enqueueBoopLineRefresh(env: Env): Promise<void> {
  const queue = env.BOOP_LINES_QUEUE;
  if (!queue) {
    await refreshBoopLines(env);
    return;
  }

  for (const mood of ["day", "night"] as const) {
    try {
      await queue.send({ mood });
    } catch (error) {
      console.error(`Failed to queue the boop line refresh for "${mood}":`, error);
    }
  }
}

interface BoopLineRow {
  body: string;
}

/** The current pool for both moods, newest first — what the client merges
 *  with its own built-in lines. */
export async function fetchBoopLinePool(env: Env): Promise<Record<BoopMood, string[]>> {
  const [day, night] = await Promise.all(
    (["day", "night"] as const).map((mood) =>
      env.DB.prepare(
        "SELECT body FROM boop_lines WHERE mood = ? ORDER BY created_at DESC, id DESC LIMIT ?",
      ).bind(mood, POOL_CAP_PER_MOOD).all<BoopLineRow>(),
    ),
  );
  return {
    day: day.results.map((r) => r.body),
    night: night.results.map((r) => r.body),
  };
}
