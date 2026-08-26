/**
 * The in-app alerts feed.
 *
 * The behaviour worth pinning down is that the feed does *not* depend on push
 * having worked: rows are written where the alert is decided, so a family with
 * no subscribed device, or a Worker with no VAPID keys configured, still has
 * something to read in the app.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { recordAlert, pruneAlerts, ALERT_RETENTION_DAYS } from "../src/alerts.js";
import { enqueueReminderChecks } from "../src/scheduled/reminders.js";
import { runFeedingTrendCheck } from "../src/scheduled/feedingTrend.js";
import { applyMigrations, createTestApp, testRequest } from "./helpers";

interface AlertRow {
  id: number;
  child_id: number;
  kind: string;
  title: string;
  body: string;
  url: string;
  dedupe_key: string;
  created_at: string;
}

interface FeedResponse {
  alerts: (AlertRow & { child_first_name: string })[];
  unread: number;
  last_read_at: string | null;
}

/** A queue binding that swallows whatever it is handed. */
function fakeQueue() {
  return { send: vi.fn(async () => {}), sendBatch: vi.fn() };
}

async function seedChild(id: number, firstName: string, userId: number) {
  await env.DB.prepare(
    `INSERT INTO children (id, first_name, last_name, birth_date) VALUES (?, ?, 'Test', '2024-01-01')`,
  )
    .bind(id, firstName)
    .run();
  await env.DB.prepare("INSERT INTO user_children (user_id, child_id) VALUES (?, ?)").bind(userId, id).run();
}

async function insertAlert(childId: number, key: string, createdAt: string, body = "Something happened.") {
  await env.DB.prepare(
    `INSERT INTO alerts (child_id, kind, title, body, url, dedupe_key, created_at)
     VALUES (?, 'diaper', 'Diaper reminder', ?, '/', ?, ?)`,
  )
    .bind(childId, body, key, createdAt)
    .run();
}

describe("recordAlert", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await env.DB.prepare("INSERT INTO users (id, email, name) VALUES (1, 'a@example.com', 'A')").run();
    await seedChild(1, "Mikey", 1);
  });

  it("writes one row and reports it", async () => {
    const written = await recordAlert(env as never, {
      childId: 1,
      kind: "diaper",
      title: "Diaper reminder",
      body: "No diaper change logged for Mikey in over 2 hours 45 minutes.",
      dedupeKey: "reminder:1:diaper:2024-01-15T08:00:00.000Z",
    });

    expect(written).toBe(true);
    const row = await env.DB.prepare("SELECT * FROM alerts").first<AlertRow>();
    expect(row).toMatchObject({ child_id: 1, kind: "diaper", title: "Diaper reminder", url: "/" });
  });

  it("ignores a second write for the same occasion", async () => {
    const alert = {
      childId: 1,
      kind: "diaper" as const,
      title: "Diaper reminder",
      body: "No diaper change logged for Mikey in over 2 hours 45 minutes.",
      dedupeKey: "reminder:1:diaper:2024-01-15T08:00:00.000Z",
    };

    expect(await recordAlert(env as never, alert)).toBe(true);
    expect(await recordAlert(env as never, alert)).toBe(false);

    const { results } = await env.DB.prepare("SELECT id FROM alerts").all();
    expect(results).toHaveLength(1);
  });

  it("never throws into the cron that is trying to send a push", async () => {
    // A child that isn't there fails the foreign key — the push behind this
    // call still has to go out.
    const written = await recordAlert(env as never, {
      childId: 999,
      kind: "feeding",
      title: "Feeding reminder",
      body: "…",
      dedupeKey: "reminder:999:feeding:x",
    });
    expect(written).toBe(false);
  });
});

describe("pruneAlerts", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await env.DB.prepare("INSERT INTO users (id, email, name) VALUES (1, 'a@example.com', 'A')").run();
    await seedChild(1, "Mikey", 1);
  });

  it("drops what has aged out and keeps the rest", async () => {
    const now = new Date("2024-07-15T12:00:00.000Z");
    const old = new Date(now.getTime() - (ALERT_RETENTION_DAYS + 1) * 86400000).toISOString();
    const recent = new Date(now.getTime() - 86400000).toISOString();
    await insertAlert(1, "old", old);
    await insertAlert(1, "recent", recent);

    expect(await pruneAlerts(env as never, now)).toBe(1);

    const { results } = await env.DB.prepare("SELECT dedupe_key FROM alerts").all<{ dedupe_key: string }>();
    expect(results.map((r) => r.dedupe_key)).toEqual(["recent"]);
  });
});

describe("the reminder cron's feed row", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00.000Z"));
    await env.DB.prepare("INSERT INTO users (id, email, name) VALUES (1, 'a@example.com', 'A')").run();
    await seedChild(1, "Mikey", 1);
    await env.DB.prepare(
      "INSERT INTO diaper_changes (child_id, time, type) VALUES (1, '2024-01-15T08:00:00.000Z', 'wet')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO feedings (child_id, start_time, type) VALUES (1, '2024-01-15T11:30:00.000Z', 'bottle_formula')",
    ).run();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records the alert even though nothing is subscribed to push", async () => {
    // No push_subscriptions row at all — the case the feed exists for.
    await enqueueReminderChecks({ ...env, REMINDER_QUEUE: fakeQueue() } as never);

    const { results } = await env.DB.prepare("SELECT * FROM alerts").all<AlertRow>();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ child_id: 1, kind: "diaper", title: "Diaper reminder" });
    // Word for word what the push says, so the two can't tell different stories.
    expect(results[0].body).toBe("No diaper change logged for Mikey Test in over 2 hours 45 minutes.");
  });

  it("logs one row per gap, not one per cron firing", async () => {
    const queue = fakeQueue();
    await enqueueReminderChecks({ ...env, REMINDER_QUEUE: queue } as never);
    vi.setSystemTime(new Date("2024-01-15T12:05:00.000Z"));
    await enqueueReminderChecks({ ...env, REMINDER_QUEUE: queue } as never);

    const { results } = await env.DB.prepare("SELECT id FROM alerts").all();
    expect(results).toHaveLength(1);
  });

  it("logs the next gap once new activity has been recorded", async () => {
    const queue = fakeQueue();
    await enqueueReminderChecks({ ...env, REMINDER_QUEUE: queue } as never);

    // A change is logged, then the gap opens again.
    await env.DB.prepare(
      "INSERT INTO diaper_changes (child_id, time, type) VALUES (1, '2024-01-15T12:10:00.000Z', 'wet')",
    ).run();
    vi.setSystemTime(new Date("2024-01-15T16:00:00.000Z"));
    await enqueueReminderChecks({ ...env, REMINDER_QUEUE: queue } as never);

    const { results } = await env.DB.prepare("SELECT id FROM alerts WHERE kind = 'diaper'").all();
    expect(results).toHaveLength(2);
  });
});

describe("the feeding-trend cron's feed row", () => {
  const ELEVEN_AM_EDT = new Date("2024-07-15T15:00:00.000Z");

  async function logFeeds(day: string, count: number, oz: number) {
    for (let i = 0; i < count; i++) {
      const hour = String(12 + i).padStart(2, "0");
      await env.DB.prepare(
        "INSERT INTO feedings (child_id, start_time, type, amount, amount_unit) VALUES (1, ?, 'bottle_formula', ?, 'oz')",
      )
        .bind(`${day}T${hour}:00:00.000Z`, oz)
        .run();
    }
  }

  beforeEach(async () => {
    await applyMigrations(env.DB);
    await env.DB.prepare("INSERT INTO users (id, email, name) VALUES (1, 'a@example.com', 'A')").run();
    await seedChild(1, "Mikey", 1);
    for (const day of ["2024-07-14", "2024-07-13", "2024-07-12", "2024-07-11", "2024-07-10", "2024-07-09", "2024-07-08"]) {
      await logFeeds(day, 6, 4);
    }
  });

  it("records the alert with the sentence that was pushed", async () => {
    await logFeeds("2024-07-15", 2, 4);
    const AI = {
      run: vi.fn(async () => ({
        response: '{"alert": true, "message": "Mikey has had 2 feeds by 11am, against 6 on an average day last week."}',
      })),
    };

    await runFeedingTrendCheck({ ...env, AI, FEEDING_TREND_QUEUE: fakeQueue() } as never, {
      now: ELEVEN_AM_EDT,
      send: true,
    });

    const row = await env.DB.prepare("SELECT * FROM alerts").first<AlertRow>();
    expect(row).toMatchObject({ child_id: 1, kind: "feeding_trend", title: "Feeding trend" });
    expect(row?.body).toContain("Mikey has had 2 feeds by 11am");
    // The checkpoint the trend cron already claims against a double firing.
    expect(row?.dedupe_key).toBe("feeding_trend:1:2024-07-15:11");
  });

  it("records nothing when the model vetoes the alert", async () => {
    await logFeeds("2024-07-15", 2, 4);
    const AI = { run: vi.fn(async () => ({ response: '{"alert": false, "message": ""}' })) };

    await runFeedingTrendCheck({ ...env, AI, FEEDING_TREND_QUEUE: fakeQueue() } as never, {
      now: ELEVEN_AM_EDT,
      send: true,
    });

    const { results } = await env.DB.prepare("SELECT id FROM alerts").all();
    expect(results).toHaveLength(0);
  });

  it("records nothing for a preview run, which spends no checkpoint", async () => {
    await logFeeds("2024-07-15", 2, 4);

    await runFeedingTrendCheck({ ...env, AI: undefined } as never, { now: ELEVEN_AM_EDT, send: false });

    const { results } = await env.DB.prepare("SELECT id FROM alerts").all();
    expect(results).toHaveLength(0);
  });
});

describe("GET /api/alerts", () => {
  const app = createTestApp();

  beforeEach(async () => {
    await applyMigrations(env.DB);
  });

  /** Two users, one child each. The test auth middleware matches on email,
   *  so these rows are the accounts the requests below arrive as. */
  async function seedTwoFamilies() {
    await env.DB.prepare("INSERT INTO users (id, email, name) VALUES (1, 'a@example.com', 'A')").run();
    await env.DB.prepare("INSERT INTO users (id, email, name) VALUES (2, 'b@example.com', 'B')").run();
    await seedChild(1, "Mikey", 1);
    await seedChild(2, "Nolan", 2);
  }

  it("only returns alerts for the children the caller is linked to", async () => {
    await seedTwoFamilies();
    await insertAlert(1, "mine", "2024-07-15T10:00:00Z", "Mikey's alert.");
    await insertAlert(2, "theirs", "2024-07-15T11:00:00Z", "Nolan's alert.");

    const res = await testRequest(app, env.DB).get("/api/alerts", { "X-Test-Email": "a@example.com" });
    const feed = (await res.json()) as FeedResponse;

    expect(res.status).toBe(200);
    expect(feed.alerts).toHaveLength(1);
    expect(feed.alerts[0]).toMatchObject({ body: "Mikey's alert.", child_first_name: "Mikey" });
  });

  it("returns them newest first, and counts everything unread until the feed is opened", async () => {
    await seedTwoFamilies();
    await insertAlert(1, "older", "2024-07-15T10:00:00Z", "Older.");
    await insertAlert(1, "newer", "2024-07-15T12:00:00Z", "Newer.");

    const feed = (await (
      await testRequest(app, env.DB).get("/api/alerts", { "X-Test-Email": "a@example.com" })
    ).json()) as FeedResponse;

    expect(feed.alerts.map((a) => a.body)).toEqual(["Newer.", "Older."]);
    expect(feed.unread).toBe(2);
    expect(feed.last_read_at).toBeNull();
  });
});

describe("POST /api/alerts/read", () => {
  const app = createTestApp();

  beforeEach(async () => {
    await applyMigrations(env.DB);
    await env.DB.prepare("INSERT INTO users (id, email, name) VALUES (1, 'a@example.com', 'A')").run();
    await seedChild(1, "Mikey", 1);
  });

  it("clears the badge for the alerts that were on screen", async () => {
    await insertAlert(1, "one", "2024-07-15T10:00:00Z");
    await insertAlert(1, "two", "2024-07-15T12:00:00Z");
    const req = testRequest(app, env.DB);

    await req.post("/api/alerts/read", { up_to: "2024-07-15T12:00:00Z" }, { "X-Test-Email": "a@example.com" });
    const feed = (await (await req.get("/api/alerts", { "X-Test-Email": "a@example.com" })).json()) as FeedResponse;

    expect(feed.unread).toBe(0);
    // The alerts themselves stay — read is not dismissed.
    expect(feed.alerts).toHaveLength(2);
  });

  it("leaves an alert raised after the fetch unread", async () => {
    await insertAlert(1, "seen", "2024-07-15T10:00:00Z");
    const req = testRequest(app, env.DB);

    // Marked read as far as the newest row that was actually rendered.
    await req.post("/api/alerts/read", { up_to: "2024-07-15T10:00:00Z" }, { "X-Test-Email": "a@example.com" });
    await insertAlert(1, "arrived-since", "2024-07-15T10:00:30Z");

    const feed = (await (await req.get("/api/alerts", { "X-Test-Email": "a@example.com" })).json()) as FeedResponse;
    expect(feed.unread).toBe(1);
  });

  it("never moves the mark backwards", async () => {
    await insertAlert(1, "one", "2024-07-15T10:00:00Z");
    await insertAlert(1, "two", "2024-07-15T12:00:00Z");
    const req = testRequest(app, env.DB);

    await req.post("/api/alerts/read", { up_to: "2024-07-15T12:00:00Z" }, { "X-Test-Email": "a@example.com" });
    // A second device, holding a drawer opened before the newer alert landed.
    await req.post("/api/alerts/read", { up_to: "2024-07-15T10:00:00Z" }, { "X-Test-Email": "a@example.com" });

    const feed = (await (await req.get("/api/alerts", { "X-Test-Email": "a@example.com" })).json()) as FeedResponse;
    expect(feed.unread).toBe(0);
    expect(feed.last_read_at).toBe("2024-07-15T12:00:00Z");
  });

  it("is per user — reading on one account doesn't clear the other's badge", async () => {
    await env.DB.prepare("INSERT INTO users (id, email, name) VALUES (2, 'b@example.com', 'B')").run();
    await env.DB.prepare("INSERT INTO user_children (user_id, child_id) VALUES (2, 1)").run();
    await insertAlert(1, "shared", "2024-07-15T10:00:00Z");
    const req = testRequest(app, env.DB);

    await req.post("/api/alerts/read", {}, { "X-Test-Email": "a@example.com" });

    const mine = (await (await req.get("/api/alerts", { "X-Test-Email": "a@example.com" })).json()) as FeedResponse;
    const theirs = (await (await req.get("/api/alerts", { "X-Test-Email": "b@example.com" })).json()) as FeedResponse;
    expect(mine.unread).toBe(0);
    expect(theirs.unread).toBe(1);
  });
});
