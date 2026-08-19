import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { env } from "cloudflare:test";
import {
  ageLabel,
  buildPrompt,
  buildTrends,
  fallbackNote,
  fetchDayStats,
  generateNoteBody,
  refreshDailyNotes,
  enqueueDailyNotes,
  writeNoteForJob,
  collectNoteJobs,
  tidyNote,
  DEFAULT_NOTE_MODEL,
  NOTE_MODEL_CHAIN,
  MAX_REPLY_TOKENS,
  MAX_NOTE_LENGTH,
  type DayStats,
} from "../src/scheduled/dailyNote.js";
import { applyMigrations, createTestApp, testRequest } from "./helpers";

const ZERO: DayStats = {
  feeds: 0,
  feedVolume: null,
  formulaOz: 0,
  diapers: 0,
  wetDiapers: 0,
  poopDiapers: 0,
  daysSinceLastPoop: null,
  sleepMinutes: 0,
  longestSleepMinutes: 0,
  sleepSessions: 0,
  tummyMinutes: 0,
};

const day = (over: Partial<DayStats>): DayStats => ({ ...ZERO, ...over });

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe("tidyNote", () => {
  it("collapses a model's line breaks into one line", () => {
    expect(tidyNote("Mikey slept well.\n\n  You did great.")).toBe(
      "Mikey slept well. You did great.",
    );
  });

  it("strips the quotes models like to wrap a line in", () => {
    expect(tidyNote('"Mikey had a steady day yesterday."')).toBe(
      "Mikey had a steady day yesterday.",
    );
  });

  it("rejects a reply too short to be a note", () => {
    expect(tidyNote("")).toBeNull();
    expect(tidyNote("Sure!")).toBeNull();
  });

  it("clips a runaway reply at a sentence boundary", () => {
    const long = `${"Mikey had a good day and slept soundly through most of it. ".repeat(10)}`;
    const tidied = tidyNote(long)!;
    expect(tidied.length).toBeLessThanOrEqual(MAX_NOTE_LENGTH);
    expect(tidied.endsWith(".")).toBe(true);
  });

  it("never returns a mid-word clip", () => {
    const long = "a".repeat(20) + " " + "word ".repeat(200);
    const tidied = tidyNote(long)!;
    expect(tidied.length).toBeLessThanOrEqual(MAX_NOTE_LENGTH + 1);
    expect(tidied).not.toMatch(/wor$/);
  });
});

describe("buildTrends", () => {
  it("says nothing at all without history to compare against", () => {
    expect(buildTrends(day({ feeds: 6 }), [])).toEqual([]);
  });

  it("calls a clear rise a rise", () => {
    const trends = buildTrends(
      day({ feeds: 9 }),
      [day({ feeds: 5 }), day({ feeds: 5 })],
    );
    expect(trends.find((t) => t.metric === "feeds")?.direction).toBe("up");
  });

  it("calls a clear fall a fall", () => {
    const trends = buildTrends(
      day({ sleepMinutes: 500 }),
      [day({ sleepMinutes: 800 }), day({ sleepMinutes: 820 })],
    );
    expect(trends.find((t) => t.metric === "sleep")?.direction).toBe("down");
  });

  it("does not dress up ordinary variation as a trend", () => {
    const trends = buildTrends(
      day({ feeds: 8 }),
      [day({ feeds: 8 }), day({ feeds: 7 }), day({ feeds: 9 })],
    );
    expect(trends.find((t) => t.metric === "feeds")?.direction).toBe("steady");
  });

  it("quotes the real figures in the phrase it hands the model", () => {
    const trends = buildTrends(day({ feeds: 6 }), [day({ feeds: 4 }), day({ feeds: 5 })]);
    expect(trends.find((t) => t.metric === "feeds")?.phrase).toBe(
      "6 feeds, against 4.5 a day over the last week",
    );
  });

  it("tracks whether formula intake is rising or falling", () => {
    const up = buildTrends(day({ formulaOz: 20 }), [day({ formulaOz: 12 }), day({ formulaOz: 12 })]);
    expect(up.find((t) => t.metric === "formula")?.direction).toBe("up");

    const down = buildTrends(day({ formulaOz: 8 }), [day({ formulaOz: 16 }), day({ formulaOz: 16 })]);
    expect(down.find((t) => t.metric === "formula")?.direction).toBe("down");
  });
});

describe("fallbackNote", () => {
  it("reports the day without inventing anything", () => {
    const note = fallbackNote("Mikey", day({ feeds: 7, diapers: 6, sleepMinutes: 800 }), []);
    expect(note).toContain("7 feeds");
    expect(note).toContain("6 diapers");
    expect(note).toContain("13h 20m of sleep");
  });

  it("is kind about a day with nothing logged", () => {
    const note = fallbackNote("Mikey", ZERO, []);
    expect(note).toContain("Nothing logged");
    expect(note).not.toMatch(/0 feeds/);
  });

  it("mentions formula ounces and poop status when they're logged", () => {
    const note = fallbackNote(
      "Mikey",
      day({ feeds: 4, formulaOz: 12, diapers: 5, poopDiapers: 2 }),
      [],
    );
    expect(note).toContain("12 oz of formula");
    expect(note).toContain("2 poopy");
  });

  it("says how long it's been since the last poop when yesterday had none", () => {
    const note = fallbackNote(
      "Mikey",
      day({ feeds: 4, diapers: 5, poopDiapers: 0, daysSinceLastPoop: 2 }),
      [],
    );
    expect(note).toContain("last poop 2d ago");
  });

  it("reads the sleep trend when there is one", () => {
    const trends = buildTrends(
      day({ sleepMinutes: 900, longestSleepMinutes: 400 }),
      [day({ sleepMinutes: 600, longestSleepMinutes: 180 })],
    );
    expect(fallbackNote("Mikey", day({ feeds: 6, sleepMinutes: 900 }), trends)).toContain(
      "trending up",
    );
  });
});

describe("ageLabel", () => {
  it("counts in the unit a parent would use", () => {
    expect(ageLabel("2024-01-01", new Date("2024-01-06T00:00:00Z"))).toBe("5 days old");
    expect(ageLabel("2024-01-01", new Date("2024-02-01T00:00:00Z"))).toBe("4 weeks old");
    expect(ageLabel("2024-01-01", new Date("2024-06-01T00:00:00Z"))).toBe("4 months old");
    expect(ageLabel("2024-01-01", new Date("2027-01-01T00:00:00Z"))).toBe("3 years old");
  });
});

describe("buildPrompt", () => {
  it("hands the model finished figures and forbids it from redoing the sums", () => {
    const { system, user } = buildPrompt("Mikey", "4 months old", day({ feeds: 6 }), []);
    expect(system).toContain("never invent, recompute");
    expect(user).toContain("Feeds yesterday: 6");
  });

  it("rules out medical advice", () => {
    const { system } = buildPrompt("Mikey", "4 months old", ZERO, []);
    expect(system).toMatch(/never give medical/i);
  });

  it("hands the model formula ounces and the poop diaper breakdown", () => {
    const { user } = buildPrompt(
      "Mikey",
      "4 months old",
      day({ diapers: 5, wetDiapers: 3, poopDiapers: 2, formulaOz: 9 }),
      [],
    );
    expect(user).toContain("Formula yesterday: 9 oz");
    expect(user).toContain("Diapers yesterday: 5 (3 wet, 2 poopy)");
    expect(user).toContain("Pooped yesterday (2×)");
  });

  it("says how long it's been since the last poop when yesterday had none", () => {
    const { user } = buildPrompt(
      "Mikey",
      "4 months old",
      day({ poopDiapers: 0, daysSinceLastPoop: 3 }),
      [],
    );
    expect(user).toContain("Last poop: 3 days ago");
  });
});

// ── Generation, with and without a model ──────────────────────────────────────

describe("generateNoteBody", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the deterministic note when there is no AI binding", async () => {
    const result = await generateNoteBody(
      { ...env, AI: undefined } as typeof env,
      "Mikey",
      "4 months old",
      day({ feeds: 6 }),
      [],
    );
    expect(result.source).toBe("fallback");
    expect(result.body).toContain("6 feeds");
  });

  it("uses the model's line when it writes a usable one", async () => {
    const AI = { run: vi.fn(async () => ({ response: "Mikey ate well and slept through. You two are doing great." })) };
    const result = await generateNoteBody(
      { ...env, AI } as unknown as typeof env,
      "Mikey",
      "4 months old",
      day({ feeds: 6 }),
      [],
    );
    expect(result).toEqual({
      source: "ai",
      body: "Mikey ate well and slept through. You two are doing great.",
    });
  });

  it("reads the reply from a model that answers in the chat-completions shape", async () => {
    // gemma-4-26b-a4b-it — the shipped default — answers this way, not with
    // a flat `response` string. A model with "reasoning" also separates its
    // thinking trace into `reasoning_content`, which must be ignored: it is
    // scratch work, not the note.
    const AI = {
      run: vi.fn(async () => ({
        choices: [
          {
            message: {
              role: "assistant",
              content: "Mikey ate well and slept through. You two are doing great.",
              reasoning_content: "The user wants two sentences about yesterday's feeds and sleep...",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 300, completion_tokens: 40 },
      })),
    };
    const result = await generateNoteBody(
      { ...env, AI } as unknown as typeof env,
      "Mikey",
      "4 months old",
      day({ feeds: 6 }),
      [],
    );
    expect(result).toEqual({
      source: "ai",
      body: "Mikey ate well and slept through. You two are doing great.",
    });
  });

  it("gives a thinking model room to think and still answer", async () => {
    // The bug this guards: max_tokens was 120, chosen as if the whole budget
    // went to the visible answer. Reasoning tokens come out of the same
    // allowance, so the model spent it all thinking and returned nothing.
    const AI = { run: vi.fn(async () => ({ response: "Mikey had a steady day. You are doing well." })) };
    await generateNoteBody(
      { ...env, AI } as unknown as typeof env,
      "Mikey",
      "4 months old",
      day({ feeds: 6 }),
      [],
    );
    const options = AI.run.mock.calls[0][1] as { max_tokens: number };
    expect(options.max_tokens).toBe(MAX_REPLY_TOKENS);
    expect(options.max_tokens).toBeGreaterThanOrEqual(500);
  });

  it("says why it fell back when the model burns its budget thinking", async () => {
    // Exactly what a thinking model returns when max_tokens runs out mid-thought.
    const AI = {
      run: vi.fn(async () => ({
        choices: [{ message: { role: "assistant", content: "" }, finish_reason: "length" }],
        usage: { completion_tokens: 120, completion_tokens_details: { reasoning_tokens: 120 } },
      })),
    };
    const result = await generateNoteBody(
      { ...env, AI } as unknown as typeof env,
      "Mikey",
      "4 months old",
      day({ feeds: 6 }),
      [],
    );
    expect(result.source).toBe("fallback");
    // The whole point: the reason names the cause instead of leaving "0 from AI".
    expect(result.reason).toContain("finish=length");
    expect(result.reason).toContain("reasoning=120");
  });

  it("names an unexpected response shape rather than staying silent", async () => {
    const AI = { run: vi.fn(async () => ({ output_text: "some third shape nobody expected" })) };
    const result = await generateNoteBody(
      { ...env, AI } as unknown as typeof env,
      "Mikey",
      "4 months old",
      day({ feeds: 6 }),
      [],
    );
    expect(result.source).toBe("fallback");
    expect(result.reason).toContain("keys=output_text");
  });

  it("reports a thrown error's message as the reason", async () => {
    const AI = { run: vi.fn(async () => { throw new Error("No such model"); }) };
    const result = await generateNoteBody(
      { ...env, AI } as unknown as typeof env,
      "Mikey",
      "4 months old",
      day({ feeds: 6 }),
      [],
    );
    expect(result.source).toBe("fallback");
    expect(result.reason).toContain("No such model");
  });

  it("gives no reason at all when the model worked", async () => {
    const AI = { run: vi.fn(async () => ({ response: "Mikey had a steady day. You are doing well." })) };
    const result = await generateNoteBody(
      { ...env, AI } as unknown as typeof env,
      "Mikey",
      "4 months old",
      day({ feeds: 6 }),
      [],
    );
    expect(result.source).toBe("ai");
    expect(result.reason).toBeUndefined();
  });

  it("tries the next model when the first one fails, and says so", async () => {
    // Why the chain exists: three separate causes have produced the identical
    // "template note, no visible error" symptom. A second model that fails
    // differently beats a fourth guess at the first one.
    const AI = {
      run: vi.fn(async (model: string) =>
        model === NOTE_MODEL_CHAIN[0]
          ? { choices: [{ message: { content: "" }, finish_reason: "length" }] }
          : { response: "Mikey had a steady day. You are doing this well." },
      ),
    };
    const result = await generateNoteBody(
      { ...env, AI } as unknown as typeof env,
      "Mikey",
      "4 months old",
      day({ feeds: 6 }),
      [],
    );
    expect(result.source).toBe("ai");
    expect(result.body).toBe("Mikey had a steady day. You are doing this well.");
    // A silently-degraded chain must not look like everything is fine.
    expect(result.reason).toContain(NOTE_MODEL_CHAIN[1]);
    expect(result.reason).toContain("finish=length");
    expect(AI.run).toHaveBeenCalledTimes(2);
  });

  it("does not call a second model when the first one works", async () => {
    const AI = { run: vi.fn(async () => ({ response: "Mikey had a steady day. You are doing well." })) };
    const result = await generateNoteBody(
      { ...env, AI } as unknown as typeof env,
      "Mikey",
      "4 months old",
      day({ feeds: 6 }),
      [],
    );
    expect(AI.run).toHaveBeenCalledTimes(1);
    expect(result.reason).toBeUndefined();
  });

  it("reports every model's failure when the whole chain fails", async () => {
    const AI = {
      run: vi.fn(async (model: string) => {
        throw new Error(`no capacity for ${model}`);
      }),
    };
    const result = await generateNoteBody(
      { ...env, AI } as unknown as typeof env,
      "Mikey",
      "4 months old",
      day({ feeds: 6 }),
      [],
    );
    expect(result.source).toBe("fallback");
    for (const model of NOTE_MODEL_CHAIN) expect(result.reason).toContain(model);
  });

  it("uses only the named model when one is configured, not the chain", async () => {
    const AI = { run: vi.fn(async () => { throw new Error("nope"); }) };
    await generateNoteBody(
      { ...env, AI, DAILY_NOTE_MODEL: "@cf/some/other-model" } as unknown as typeof env,
      "Mikey",
      "4 months old",
      day({ feeds: 6 }),
      [],
    );
    // An explicit override is a decision, not a first preference.
    expect(AI.run).toHaveBeenCalledTimes(1);
    expect(AI.run.mock.calls[0][0]).toBe("@cf/some/other-model");
  });

  it("falls back rather than failing when the model errors", async () => {
    const AI = { run: vi.fn(async () => { throw new Error("out of capacity"); }) };
    const result = await generateNoteBody(
      { ...env, AI } as unknown as typeof env,
      "Mikey",
      "4 months old",
      day({ feeds: 6 }),
      [],
    );
    expect(result.source).toBe("fallback");
    expect(result.body).toContain("6 feeds");
  });

  it("falls back rather than printing an empty or junk reply", async () => {
    const AI = { run: vi.fn(async () => ({ response: "  " })) };
    const result = await generateNoteBody(
      { ...env, AI } as unknown as typeof env,
      "Mikey",
      "4 months old",
      day({ feeds: 6 }),
      [],
    );
    expect(result.source).toBe("fallback");
  });

  it("defaults to the configured model when nothing overrides it", async () => {
    const AI = { run: vi.fn(async () => ({ response: "Mikey had a steady day. You are doing well." })) };
    await generateNoteBody(
      { ...env, AI } as unknown as typeof env,
      "Mikey",
      "4 months old",
      day({ feeds: 6 }),
      [],
    );
    expect(AI.run.mock.calls[0][0]).toBe(DEFAULT_NOTE_MODEL);
    // A slug Workers AI does not recognise fails every call and falls back
    // forever, silently — so pin the shape the model catalog actually uses.
    expect(DEFAULT_NOTE_MODEL).toMatch(/^@cf\/[a-z0-9-]+\/[a-z0-9.-]+$/);
  });

  it("honours a configured model override", async () => {
    const AI = { run: vi.fn(async () => ({ response: "Mikey had a steady day. You are doing well." })) };
    await generateNoteBody(
      { ...env, AI, DAILY_NOTE_MODEL: "@cf/some/other-model" } as unknown as typeof env,
      "Mikey",
      "4 months old",
      day({ feeds: 6 }),
      [],
    );
    expect(AI.run.mock.calls[0][0]).toBe("@cf/some/other-model");
  });
});

// ── Stats and the daily run ───────────────────────────────────────────────────

describe("fetchDayStats", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await env.DB.prepare(
      "INSERT INTO children (id, first_name, last_name, birth_date) VALUES (1, 'Mikey', 'F', '2024-01-01')",
    ).run();
  });

  it("counts only what falls inside the day", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO feedings (child_id, type, start_time, amount, amount_unit) VALUES (1, 'bottle_formula', '2024-01-14T10:00:00.000Z', 100, 'ml')"),
      env.DB.prepare("INSERT INTO feedings (child_id, type, start_time, amount, amount_unit) VALUES (1, 'bottle_formula', '2024-01-14T14:00:00.000Z', 120, 'ml')"),
      // The day before — must not be counted.
      env.DB.prepare("INSERT INTO feedings (child_id, type, start_time, amount, amount_unit) VALUES (1, 'bottle_formula', '2024-01-13T10:00:00.000Z', 999, 'ml')"),
      env.DB.prepare("INSERT INTO diaper_changes (child_id, time, type) VALUES (1, '2024-01-14T11:00:00.000Z', 'wet')"),
    ]);

    const stats = await fetchDayStats(env, 1, "2024-01-14T05:00:00.000Z", "2024-01-15T05:00:00.000Z", "ml");
    expect(stats.feeds).toBe(2);
    expect(stats.feedVolume).toEqual({ value: 220, unit: "mL" });
    expect(stats.diapers).toBe(1);
    // 220 mL of formula, restated in ounces regardless of the display unit.
    expect(stats.formulaOz).toBeCloseTo(7.4, 1);
  });

  it("breaks diapers down into wet and poopy, and answers 'when did they last poop'", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO diaper_changes (child_id, time, type) VALUES (1, '2024-01-14T08:00:00.000Z', 'wet')"),
      env.DB.prepare("INSERT INTO diaper_changes (child_id, time, type) VALUES (1, '2024-01-14T12:00:00.000Z', 'solid')"),
      env.DB.prepare("INSERT INTO diaper_changes (child_id, time, type) VALUES (1, '2024-01-14T18:00:00.000Z', 'both')"),
    ]);

    const stats = await fetchDayStats(env, 1, "2024-01-14T05:00:00.000Z", "2024-01-15T05:00:00.000Z", "ml");
    expect(stats.diapers).toBe(3);
    expect(stats.wetDiapers).toBe(2); // 'wet' + 'both'
    expect(stats.poopDiapers).toBe(2); // 'solid' + 'both'
    // Pooped yesterday, so there's nothing to count back to.
    expect(stats.daysSinceLastPoop).toBeNull();
  });

  it("counts back to the last poop when there wasn't one yesterday", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO diaper_changes (child_id, time, type) VALUES (1, '2024-01-12T12:00:00.000Z', 'solid')"),
      env.DB.prepare("INSERT INTO diaper_changes (child_id, time, type) VALUES (1, '2024-01-14T08:00:00.000Z', 'wet')"),
    ]);

    const stats = await fetchDayStats(env, 1, "2024-01-14T05:00:00.000Z", "2024-01-15T05:00:00.000Z", "ml");
    expect(stats.poopDiapers).toBe(0);
    expect(stats.daysSinceLastPoop).toBe(2);
  });

  it("says the last poop is unknown when none has ever been logged", async () => {
    const stats = await fetchDayStats(env, 1, "2024-01-14T05:00:00.000Z", "2024-01-15T05:00:00.000Z", "ml");
    expect(stats.poopDiapers).toBe(0);
    expect(stats.daysSinceLastPoop).toBeNull();
  });

  it("credits a nap that runs past midnight to each day it covers", async () => {
    // 23:00 → 02:00 ET, i.e. one hour on the 14th and two on the 15th.
    await env.DB.prepare(
      "INSERT INTO sleep (child_id, start_time, end_time, is_nap) VALUES (1, '2024-01-15T04:00:00.000Z', '2024-01-15T07:00:00.000Z', 0)",
    ).run();

    const first = await fetchDayStats(env, 1, "2024-01-14T05:00:00.000Z", "2024-01-15T05:00:00.000Z", "ml");
    const second = await fetchDayStats(env, 1, "2024-01-15T05:00:00.000Z", "2024-01-16T05:00:00.000Z", "ml");
    expect(first.sleepMinutes).toBe(60);
    expect(second.sleepMinutes).toBe(120);
  });

  it("reports the longest single stretch, not just the total", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sleep (child_id, start_time, end_time, is_nap) VALUES (1, '2024-01-14T12:00:00.000Z', '2024-01-14T13:00:00.000Z', 1)"),
      env.DB.prepare("INSERT INTO sleep (child_id, start_time, end_time, is_nap) VALUES (1, '2024-01-14T16:00:00.000Z', '2024-01-14T19:00:00.000Z', 1)"),
    ]);

    const stats = await fetchDayStats(env, 1, "2024-01-14T05:00:00.000Z", "2024-01-15T05:00:00.000Z", "ml");
    expect(stats.sleepMinutes).toBe(240);
    expect(stats.longestSleepMinutes).toBe(180);
    expect(stats.sleepSessions).toBe(2);
  });
});

describe("refreshDailyNotes", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO children (id, first_name, last_name, birth_date) VALUES (1, 'Mikey', 'F', '2023-09-01')"),
      env.DB.prepare("INSERT INTO children (id, first_name, last_name, birth_date) VALUES (2, 'Sam', 'F', '2023-09-01')"),
      env.DB.prepare("INSERT INTO feedings (child_id, type, start_time, amount, amount_unit) VALUES (1, 'bottle_formula', '2024-01-14T10:00:00.000Z', 100, 'ml')"),
    ]);
  });

  afterEach(() => vi.restoreAllMocks());

  const NOW = new Date("2024-01-15T05:00:00.000Z");

  it("writes one note per child, dated to the day it describes", async () => {
    const written = await refreshDailyNotes({ ...env, AI: undefined } as typeof env, NOW);
    expect(written).toHaveLength(2);
    expect(written.every((n) => n.note_date === "2024-01-14")).toBe(true);

    const { results } = await env.DB.prepare(
      "SELECT child_id, note_date, source FROM child_daily_notes ORDER BY child_id",
    ).all();
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ child_id: 1, note_date: "2024-01-14", source: "fallback" });
  });

  it("talks in ounces regardless of any reader's own display setting", async () => {
    // A 100 mL feed logged is ~3.4 oz. If a household setting leaked in here,
    // this would say mL instead, or 100 instead of 3.4.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, email, name) VALUES (1, 'a@example.com', 'A')"),
      env.DB.prepare("INSERT INTO user_settings (user_id, volume_unit) VALUES (1, 'ml')"),
    ]);
    const written = await refreshDailyNotes({ ...env, AI: undefined } as typeof env, NOW);
    expect(written.find((n) => n.child_id === 1)?.body).toContain("oz");
  });

  it("calls the model once per child, not once per reader", async () => {
    const AI = { run: vi.fn(async () => ({ response: "Mikey had a steady day yesterday. You are doing this well." })) };
    await refreshDailyNotes({ ...env, AI } as unknown as typeof env, NOW);
    expect(AI.run).toHaveBeenCalledTimes(2);
  });

  it("updates in place when the day is generated again", async () => {
    await refreshDailyNotes({ ...env, AI: undefined } as typeof env, NOW);
    await refreshDailyNotes({ ...env, AI: undefined } as typeof env, NOW);

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM child_daily_notes WHERE child_id = 1",
    ).first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("says so loudly when every note fell back despite a binding", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // What a wrong model slug looks like from here.
    const AI = { run: vi.fn(async () => { throw new Error("No such model"); }) };

    await refreshDailyNotes({ ...env, AI } as unknown as typeof env, NOW);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("fell back to the template"));
    // Two kinds of line now: one per child naming that child's reason, and one
    // aggregate naming the model. Assert across all of them rather than
    // pinning an order.
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes(DEFAULT_NOTE_MODEL))).toBe(true);
    expect(lines.some((l) => l.includes("No such model"))).toBe(true);
  });

  it("stays quiet when the model is doing its job", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const AI = { run: vi.fn(async () => ({ response: "Mikey had a steady day yesterday. You are doing this well." })) };

    await refreshDailyNotes({ ...env, AI } as unknown as typeof env, NOW);

    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn when there is simply no binding to use", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await refreshDailyNotes({ ...env, AI: undefined } as typeof env, NOW);
    expect(warn).not.toHaveBeenCalled();
  });

  it("still writes the other children's notes when one child fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Keyed on which child's prompt this is, not on call order: the model
    // chain means one child can legitimately take more than one call.
    const AI = {
      run: vi.fn(async (_model: string, opts: { messages: { content: string }[] }) => {
        const prompt = opts.messages.map((m) => m.content).join(" ");
        if (prompt.includes("Mikey")) throw new Error("model down for this one");
        return { response: "Sam had a steady day yesterday. You are doing this well." };
      }),
    };
    const written = await refreshDailyNotes({ ...env, AI } as unknown as typeof env, NOW);
    // The failing child falls back rather than being skipped, so both get a note.
    expect(written).toHaveLength(2);
    expect(written.find((n) => n.child_id === 1)?.source).toBe("fallback");
    expect(written.find((n) => n.child_id === 2)?.source).toBe("ai");
  });
});

describe("enqueueDailyNotes", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO children (id, first_name, last_name, birth_date) VALUES (1, 'Mikey', 'F', '2023-09-01')"),
      env.DB.prepare("INSERT INTO children (id, first_name, last_name, birth_date) VALUES (2, 'Sam', 'F', '2023-09-01')"),
      env.DB.prepare("INSERT INTO feedings (child_id, type, start_time, amount, amount_unit) VALUES (1, 'bottle_formula', '2024-01-14T10:00:00.000Z', 100, 'ml')"),
    ]);
  });

  afterEach(() => vi.restoreAllMocks());

  const NOW = new Date("2024-01-15T05:00:00.000Z");

  it("leaves a readable note on the card before any model is asked", async () => {
    const send = vi.fn(async () => {});
    const AI = { run: vi.fn(async () => ({ response: "should not be called here" })) };

    await enqueueDailyNotes({ ...env, NOTE_QUEUE: { send }, AI } as unknown as typeof env, NOW);

    // The card is never empty while the queue works through the backlog.
    const { results } = await env.DB.prepare(
      "SELECT child_id, source, body FROM child_daily_notes ORDER BY child_id",
    ).all<{ child_id: number; source: string; body: string }>();
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.source === "fallback")).toBe(true);
    expect(results[0].body).toContain("1 feed");
    // Generation is the consumer's job, not the cron's.
    expect(AI.run).not.toHaveBeenCalled();
  });

  it("queues one job per child, carrying the figures with it", async () => {
    const send = vi.fn(async () => {});
    await enqueueDailyNotes({ ...env, NOTE_QUEUE: { send } } as unknown as typeof env, NOW);

    expect(send).toHaveBeenCalledTimes(2);
    const job = send.mock.calls[0][0] as { childId: number; noteDate: string; day: DayStats };
    expect(job.childId).toBe(1);
    expect(job.noteDate).toBe("2024-01-14");
    // Carried, not recomputed: a retry must describe the day it was queued for.
    expect(job.day.feeds).toBe(1);
  });

  it("generates inline when there is no queue binding", async () => {
    const AI = { run: vi.fn(async () => ({ response: "Mikey had a steady day. You are doing this well." })) };
    const written = await enqueueDailyNotes(
      { ...env, NOTE_QUEUE: undefined, AI } as unknown as typeof env,
      NOW,
    );
    expect(written).toHaveLength(2);
    expect(written.every((n) => n.source === "ai")).toBe(true);
    expect(AI.run).toHaveBeenCalledTimes(2);
  });

  it("still queues the other children when one child's send fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn(async (job: { childId: number }) => {
      if (job.childId === 1) throw new Error("queue unavailable");
    });
    const written = await enqueueDailyNotes({ ...env, NOTE_QUEUE: { send } } as unknown as typeof env, NOW);
    expect(written).toHaveLength(1);
    expect(written[0].child_id).toBe(2);
  });
});

describe("writeNoteForJob", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await env.DB.prepare(
      "INSERT INTO children (id, first_name, last_name, birth_date) VALUES (1, 'Mikey', 'F', '2023-09-01')",
    ).run();
  });

  afterEach(() => vi.restoreAllMocks());

  const job = {
    childId: 1,
    firstName: "Mikey",
    ageLabel: "4 months old",
    noteDate: "2024-01-14",
    day: day({ feeds: 6 }),
    trends: [],
  };

  it("replaces the template note with the model's when one arrives", async () => {
    await env.DB.prepare(
      "INSERT INTO child_daily_notes (child_id, note_date, body, source) VALUES (1, '2024-01-14', 'template text', 'fallback')",
    ).run();

    const AI = { run: vi.fn(async () => ({ response: "Mikey had a steady day. You are doing this well." })) };
    const note = await writeNoteForJob({ ...env, AI } as unknown as typeof env, job);

    expect(note.source).toBe("ai");
    const row = await env.DB.prepare(
      "SELECT body, source FROM child_daily_notes WHERE child_id = 1",
    ).first<{ body: string; source: string }>();
    expect(row).toMatchObject({ source: "ai", body: "Mikey had a steady day. You are doing this well." });
  });

  it("reports a fallback so the consumer knows to retry", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const AI = { run: vi.fn(async () => { throw new Error("out of capacity"); }) };
    const note = await writeNoteForJob({ ...env, AI } as unknown as typeof env, job);
    expect(note.source).toBe("fallback");
    expect(note.reason).toContain("out of capacity");
  });
});

describe("collectNoteJobs", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
  });

  it("returns nothing at all when there are no children", async () => {
    expect(await collectNoteJobs(env, new Date("2024-01-15T05:00:00.000Z"))).toEqual([]);
  });
});

// ── The route the dashboard reads ─────────────────────────────────────────────

describe("GET /api/children/:id/daily-note", () => {
  let api: ReturnType<typeof testRequest>;

  beforeEach(async () => {
    const app = createTestApp();
    await applyMigrations(env.DB);
    api = testRequest(app, env.DB);
    await env.DB.prepare(
      "INSERT INTO children (id, first_name, last_name, birth_date) VALUES (1, 'Mikey', 'F', '2023-09-01')",
    ).run();
  });

  const today = () => new Date().toISOString().slice(0, 10);

  it("returns today's note", async () => {
    await env.DB.prepare(
      "INSERT INTO child_daily_notes (child_id, note_date, body, source) VALUES (1, ?, 'Mikey had a steady day.', 'ai')",
    ).bind(today()).run();

    const res = await api.get("/api/children/1/daily-note");
    expect(res.status).toBe(200);
    const json = await res.json<{ note: { body: string; source: string } | null }>();
    expect(json.note).toMatchObject({ body: "Mikey had a steady day.", source: "ai" });
  });

  it("returns nothing rather than calling a week-old note yesterday", async () => {
    await env.DB.prepare(
      "INSERT INTO child_daily_notes (child_id, note_date, body, source) VALUES (1, '2020-01-01', 'Ancient.', 'ai')",
    ).run();

    const res = await api.get("/api/children/1/daily-note");
    expect(res.status).toBe(200);
    expect((await res.json<{ note: unknown }>()).note).toBeNull();
  });

  it("is empty, not broken, before the first run", async () => {
    const res = await api.get("/api/children/1/daily-note");
    expect(res.status).toBe(200);
    expect((await res.json<{ note: unknown }>()).note).toBeNull();
  });

  it("404s for a child that does not exist", async () => {
    const res = await api.get("/api/children/999/daily-note");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/daily-notes/refresh", () => {
  let api: ReturnType<typeof testRequest>;

  beforeEach(async () => {
    const app = createTestApp();
    await applyMigrations(env.DB);
    api = testRequest(app, env.DB);
    await env.DB.prepare(
      "INSERT INTO children (id, first_name, last_name, birth_date) VALUES (1, 'Mikey', 'F', '2023-09-01')",
    ).run();
  });

  it("writes today's note on demand, without waiting for the cron", async () => {
    const res = await api.post("/api/daily-notes/refresh", {});
    expect(res.status).toBe(200);

    const json = await res.json<{ written: { child_id: number; source: string }[] }>();
    expect(json.written).toHaveLength(1);
    expect(json.written[0]).toMatchObject({ child_id: 1 });

    const note = await api.get("/api/children/1/daily-note");
    expect((await note.json<{ note: { body: string } | null }>()).note?.body).toBeTruthy();
  });

  it("is safe to call twice — the second call updates in place, not duplicates", async () => {
    await api.post("/api/daily-notes/refresh", {});
    await api.post("/api/daily-notes/refresh", {});

    const { n } = (await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM child_daily_notes WHERE child_id = 1",
    ).first<{ n: number }>())!;
    expect(n).toBe(1);
  });
});
