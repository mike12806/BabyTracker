import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import {
  tidyBoopLine,
  parseBoopLines,
  generateBoopLines,
  refreshMood,
  refreshBoopLines,
  enqueueBoopLineRefresh,
  fetchBoopLinePool,
  DEFAULT_BOOP_LINE_MODEL,
  POOL_CAP_PER_MOOD,
} from "../src/scheduled/boopLines.js";
import { applyMigrations, createTestApp, testRequest } from "./helpers";

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe("tidyBoopLine", () => {
  it("strips quotes and list-style prefixes a model likes to add", () => {
    expect(tidyBoopLine('1. "Squish attack."')).toBe("Squish attack.");
    expect(tidyBoopLine("- Boop achieved.")).toBe("Boop achieved.");
  });

  it("collapses internal whitespace", () => {
    expect(tidyBoopLine("Boop   received.\n")).toBe("Boop received.");
  });

  it("rejects an empty or whitespace-only candidate", () => {
    expect(tidyBoopLine("")).toBeNull();
    expect(tidyBoopLine("   ")).toBeNull();
  });

  it("rejects a candidate that reads like a sentence, not a caption", () => {
    const long = "This is a very long line that goes on and on well past a caption's length.";
    expect(tidyBoopLine(long)).toBeNull();
  });
});

describe("parseBoopLines", () => {
  it("splits one line per candidate and tidies each", () => {
    const raw = "1. Boop.\n2. Squish achieved.\n3. Certified good baby.";
    expect(parseBoopLines(raw, 3)).toEqual(["Boop.", "Squish achieved.", "Certified good baby."]);
  });

  it("drops duplicates, case-insensitively", () => {
    const raw = "Boop.\nboop.\nSquish.";
    expect(parseBoopLines(raw, 3)).toEqual(["Boop.", "Squish."]);
  });

  it("caps at the requested count even with more usable lines available", () => {
    const raw = "One.\nTwo.\nThree.\nFour.";
    expect(parseBoopLines(raw, 2)).toEqual(["One.", "Two."]);
  });

  it("skips blank lines and lines that don't survive tidying", () => {
    const raw = "Boop.\n\n   \nSquish.";
    expect(parseBoopLines(raw, 5)).toEqual(["Boop.", "Squish."]);
  });
});

describe("generateBoopLines", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns nothing, not an error, without an AI binding", async () => {
    const result = await generateBoopLines({ ...env, AI: undefined } as typeof env, "day");
    expect(result).toEqual({ lines: [], reason: "no AI binding" });
  });

  it("parses the model's reply into individual lines", async () => {
    const AI = { run: vi.fn(async () => ({ response: "Boop.\nSquish.\nTiny victory." })) };
    const result = await generateBoopLines({ ...env, AI } as unknown as typeof env, "day");
    expect(result.lines).toEqual(["Boop.", "Squish.", "Tiny victory."]);
    expect(AI.run).toHaveBeenCalledWith(
      DEFAULT_BOOP_LINE_MODEL,
      expect.objectContaining({ messages: expect.any(Array) }),
    );
  });

  it("reads the chat-completions reply shape too", async () => {
    const AI = {
      run: vi.fn(async () => ({
        choices: [{ message: { content: "Boop.\nSquish." } }],
      })),
    };
    const result = await generateBoopLines({ ...env, AI } as unknown as typeof env, "night");
    expect(result.lines).toEqual(["Boop.", "Squish."]);
  });

  it("falls through to the backup model when the first throws", async () => {
    const AI = {
      run: vi
        .fn()
        .mockRejectedValueOnce(new Error("out of capacity"))
        .mockResolvedValueOnce({ response: "Boop.\nSquish." }),
    };
    const result = await generateBoopLines({ ...env, AI } as unknown as typeof env, "day");
    expect(result.lines).toEqual(["Boop.", "Squish."]);
    expect(AI.run).toHaveBeenCalledTimes(2);
  });

  it("names every failure when nothing usable comes back", async () => {
    const AI = { run: vi.fn(async () => { throw new Error("No such model"); }) };
    const result = await generateBoopLines({ ...env, AI } as unknown as typeof env, "day");
    expect(result.lines).toEqual([]);
    expect(result.reason).toContain("No such model");
  });

  it("respects an explicit model override, skipping the chain", async () => {
    const AI = { run: vi.fn(async () => ({ response: "Boop.\nSquish." })) };
    await generateBoopLines(
      { ...env, AI, BOOP_LINES_MODEL: "@cf/custom/model" } as unknown as typeof env,
      "day",
    );
    expect(AI.run).toHaveBeenCalledTimes(1);
    expect(AI.run).toHaveBeenCalledWith("@cf/custom/model", expect.anything());
  });
});

// ── DB-backed behavior ──────────────────────────────────────────────────────────

describe("refreshMood", () => {
  beforeEach(() => applyMigrations(env.DB));
  afterEach(() => vi.restoreAllMocks());

  it("stores the lines the model wrote", async () => {
    const AI = { run: vi.fn(async () => ({ response: "Boop.\nSquish.\nTiny victory.\nCleared for landing." })) };
    const result = await refreshMood({ ...env, AI } as unknown as typeof env, "day");
    expect(result.added).toBe(4);

    const { results } = await env.DB.prepare("SELECT body FROM boop_lines WHERE mood = 'day'").all<{ body: string }>();
    expect(results.map((r) => r.body)).toContain("Boop.");
  });

  it("adds nothing and warns when the model has nothing usable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const AI = { run: vi.fn(async () => { throw new Error("down"); }) };
    const result = await refreshMood({ ...env, AI } as unknown as typeof env, "night");
    expect(result.added).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"night"'));

    const { results } = await env.DB.prepare("SELECT * FROM boop_lines").all();
    expect(results).toHaveLength(0);
  });

  it("prunes the oldest rows once a mood's pool exceeds its cap", async () => {
    // Seed the pool right up to the cap with rows the pruning query can order
    // unambiguously by created_at.
    const seedInserts = Array.from({ length: POOL_CAP_PER_MOOD }, (_, i) =>
      env.DB.prepare(
        "INSERT INTO boop_lines (mood, body, created_at) VALUES ('day', ?, ?)",
      ).bind(`Seed line ${i}`, `2024-01-01T00:${String(i).padStart(2, "0")}:00Z`),
    );
    await env.DB.batch(seedInserts);

    const AI = { run: vi.fn(async () => ({ response: "Brand new boop." })) };
    await refreshMood({ ...env, AI } as unknown as typeof env, "day");

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM boop_lines WHERE mood = 'day'",
    ).first<{ n: number }>();
    expect(count?.n).toBeLessThanOrEqual(POOL_CAP_PER_MOOD);

    const newest = await env.DB.prepare(
      "SELECT body FROM boop_lines WHERE mood = 'day' ORDER BY created_at DESC, id DESC LIMIT 1",
    ).first<{ body: string }>();
    expect(newest?.body).toBe("Brand new boop.");

    const oldestStillThere = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM boop_lines WHERE body = 'Seed line 0'",
    ).first<{ n: number }>();
    expect(oldestStillThere?.n).toBe(0);
  });

  it("leaves the other mood's pool untouched", async () => {
    const AI = { run: vi.fn(async () => ({ response: "Boop." })) };
    await refreshMood({ ...env, AI } as unknown as typeof env, "day");

    const night = await env.DB.prepare("SELECT COUNT(*) AS n FROM boop_lines WHERE mood = 'night'").first<{ n: number }>();
    expect(night?.n).toBe(0);
  });
});

describe("refreshBoopLines", () => {
  beforeEach(() => applyMigrations(env.DB));
  afterEach(() => vi.restoreAllMocks());

  it("refreshes both moods independently in one call", async () => {
    const AI = {
      run: vi.fn(async (_model: string, opts: { messages: { content: string }[] }) => {
        const prompt = opts.messages.map((m) => m.content).join(" ");
        return { response: prompt.includes("late-night") ? "Shh.\nStill cute." : "Boop.\nSquish." };
      }),
    };
    const result = await refreshBoopLines({ ...env, AI } as unknown as typeof env);
    expect(result.day.added).toBe(2);
    expect(result.night.added).toBe(2);
  });

  it("a failure in one mood does not cost the other its lines", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const AI = {
      run: vi.fn(async (_model: string, opts: { messages: { content: string }[] }) => {
        const prompt = opts.messages.map((m) => m.content).join(" ");
        if (prompt.includes("late-night")) throw new Error("down for this mood");
        return { response: "Boop.\nSquish." };
      }),
    };
    const result = await refreshBoopLines({ ...env, AI } as unknown as typeof env);
    expect(result.day.added).toBe(2);
    expect(result.night.added).toBe(0);
  });
});

describe("enqueueBoopLineRefresh", () => {
  beforeEach(() => applyMigrations(env.DB));
  afterEach(() => vi.restoreAllMocks());

  it("queues one job per mood rather than generating inline", async () => {
    const send = vi.fn(async () => {});
    const AI = { run: vi.fn(async () => ({ response: "should not be called here" })) };
    await enqueueBoopLineRefresh({ ...env, BOOP_LINES_QUEUE: { send }, AI } as unknown as typeof env);

    expect(send).toHaveBeenCalledTimes(2);
    const moods = send.mock.calls.map((c) => (c[0] as { mood: string }).mood).sort();
    expect(moods).toEqual(["day", "night"]);
    expect(AI.run).not.toHaveBeenCalled();
  });

  it("falls back to generating inline when there is no queue binding", async () => {
    const AI = { run: vi.fn(async () => ({ response: "Boop.\nSquish." })) };
    await enqueueBoopLineRefresh({ ...env, BOOP_LINES_QUEUE: undefined, AI } as unknown as typeof env);
    expect(AI.run).toHaveBeenCalledTimes(2);
  });

  it("still queues the other mood when one send fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn(async (job: { mood: string }) => {
      if (job.mood === "day") throw new Error("queue unavailable");
    });
    await enqueueBoopLineRefresh({ ...env, BOOP_LINES_QUEUE: { send } } as unknown as typeof env);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("fetchBoopLinePool", () => {
  beforeEach(() => applyMigrations(env.DB));

  it("returns empty pools with no rows yet", async () => {
    expect(await fetchBoopLinePool(env)).toEqual({ day: [], night: [] });
  });

  it("returns each mood's lines newest first", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO boop_lines (mood, body, created_at) VALUES ('day', 'Older.', '2024-01-01T00:00:00Z')"),
      env.DB.prepare("INSERT INTO boop_lines (mood, body, created_at) VALUES ('day', 'Newer.', '2024-01-02T00:00:00Z')"),
      env.DB.prepare("INSERT INTO boop_lines (mood, body, created_at) VALUES ('night', 'Night line.', '2024-01-01T00:00:00Z')"),
    ]);
    const pool = await fetchBoopLinePool(env);
    expect(pool.day).toEqual(["Newer.", "Older."]);
    expect(pool.night).toEqual(["Night line."]);
  });
});

// ── Route ────────────────────────────────────────────────────────────────────

describe("GET /api/boop-lines", () => {
  beforeEach(() => applyMigrations(env.DB));

  it("answers empty pools before any cron has run", async () => {
    const app = createTestApp();
    const request = testRequest(app, env.DB);
    const res = await request.get("/api/boop-lines");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ day: [], night: [] });
  });

  it("returns the stored lines", async () => {
    await env.DB.prepare("INSERT INTO boop_lines (mood, body) VALUES ('day', 'Squish.')").run();
    const app = createTestApp();
    const request = testRequest(app, env.DB);
    const res = await request.get("/api/boop-lines");
    const body = await res.json() as { day: string[]; night: string[] };
    expect(body.day).toContain("Squish.");
  });
});

describe("POST /api/boop-lines/refresh", () => {
  beforeEach(() => applyMigrations(env.DB));

  it("generates inline and returns how many lines each mood got", async () => {
    const app = createTestApp();
    const request = testRequest(app, env.DB);
    const res = await request.post("/api/boop-lines/refresh", {});
    expect(res.status).toBe(200);
    const body = await res.json() as Record<"day" | "night", { added: number }>;
    // No AI binding in the test app, so this exercises the "no binding" path
    // end to end rather than asserting a specific count.
    expect(body.day.added).toBe(0);
    expect(body.night.added).toBe(0);
  });
});
