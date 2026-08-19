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
  tidyNote,
  DEFAULT_NOTE_MODEL,
  MAX_NOTE_LENGTH,
  type DayStats,
} from "../src/scheduled/dailyNote.js";
import { applyMigrations, createTestApp, testRequest } from "./helpers";

const ZERO: DayStats = {
  feeds: 0,
  feedVolume: null,
  diapers: 0,
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

  it("falls back rather than failing when the model errors", async () => {
    const AI = { run: vi.fn(async () => { throw new Error("out of capacity"); }) };
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    expect(warn.mock.calls[0][0]).toContain(DEFAULT_NOTE_MODEL);
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
    let calls = 0;
    const AI = {
      run: vi.fn(async () => {
        calls++;
        if (calls === 1) throw new Error("model down for this one");
        return { response: "Sam had a steady day yesterday. You are doing this well." };
      }),
    };
    const written = await refreshDailyNotes({ ...env, AI } as unknown as typeof env, NOW);
    // The first child falls back rather than being skipped, so both get a note.
    expect(written).toHaveLength(2);
    expect(written[0].source).toBe("fallback");
    expect(written[1].source).toBe("ai");
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
