import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { computeDailyWindow } from "../src/scheduled/dailySummary.js";
import { sendDailySummary } from "../src/scheduled/dailySummary.js";
import { applyMigrations } from "./helpers";

// ── computeDailyWindow ────────────────────────────────────────────────────────

describe("computeDailyWindow", () => {
  it("covers the previous ET calendar day during standard time (EST, UTC-5)", () => {
    // 5:00 AM UTC on Jan 15 = midnight EST
    const now = new Date("2024-01-15T05:00:00.000Z");
    const { windowStart, windowEnd, reportDateLabel } = computeDailyWindow(now);
    // Jan 14 midnight EST = 05:00 UTC, Jan 15 midnight EST = 05:00 UTC
    expect(windowStart).toBe("2024-01-14T05:00:00.000Z");
    expect(windowEnd).toBe("2024-01-15T05:00:00.000Z");
    expect(reportDateLabel).toContain("January 14");
  });

  it("covers the previous ET calendar day during daylight saving time (EDT, UTC-4)", () => {
    // 5:00 AM UTC on Jul 15 = 1:00 AM EDT
    const now = new Date("2024-07-15T05:00:00.000Z");
    const { windowStart, windowEnd, reportDateLabel } = computeDailyWindow(now);
    // Jul 14 midnight EDT = 04:00 UTC, Jul 15 midnight EDT = 04:00 UTC
    expect(windowStart).toBe("2024-07-14T04:00:00.000Z");
    expect(windowEnd).toBe("2024-07-15T04:00:00.000Z");
    expect(reportDateLabel).toContain("July 14");
  });

  it("handles DST spring-forward correctly (2024-03-10, clocks skip 2→3 AM)", () => {
    // Spring forward: at 2:00 AM EST (07:00 UTC) clocks jump to 3:00 AM EDT.
    // Cron fires at 05:00 UTC = midnight EST on March 10 (before the transition).
    const now = new Date("2024-03-10T05:00:00.000Z");
    const { windowStart, windowEnd } = computeDailyWindow(now);
    // Both midnight boundaries are in EST
    expect(windowStart).toBe("2024-03-09T05:00:00.000Z"); // midnight EST Mar 9
    expect(windowEnd).toBe("2024-03-10T05:00:00.000Z");   // midnight EST Mar 10
  });

  it("handles the first day after DST spring-forward (2024-03-11, window is 23h)", () => {
    // After spring forward, cron at 05:00 UTC = 1:00 AM EDT on March 11.
    const now = new Date("2024-03-11T05:00:00.000Z");
    const { windowStart, windowEnd } = computeDailyWindow(now);
    // Mar 10 midnight = EST = 05:00 UTC; Mar 11 midnight = EDT = 04:00 UTC
    // Window is 23h (spring-forward day is short)
    expect(windowStart).toBe("2024-03-10T05:00:00.000Z"); // midnight EST Mar 10
    expect(windowEnd).toBe("2024-03-11T04:00:00.000Z");   // midnight EDT Mar 11
    const diffHours = (new Date(windowEnd).getTime() - new Date(windowStart).getTime()) / 3600000;
    expect(diffHours).toBe(23);
  });

  it("handles DST fall-back correctly (2024-11-03, window starts in EDT)", () => {
    // Fall back: at 2:00 AM EDT (06:00 UTC) clocks fall back to 1:00 AM EST.
    // Cron fires at 05:00 UTC = 1:00 AM EDT on November 3 (before the transition).
    const now = new Date("2024-11-03T05:00:00.000Z");
    const { windowStart, windowEnd } = computeDailyWindow(now);
    // Both midnight boundaries are in EDT
    expect(windowStart).toBe("2024-11-02T04:00:00.000Z"); // midnight EDT Nov 2
    expect(windowEnd).toBe("2024-11-03T04:00:00.000Z");   // midnight EDT Nov 3
  });

  it("handles the first day after DST fall-back (2024-11-04, window is 25h)", () => {
    // After fall back, cron at 05:00 UTC = midnight EST on November 4.
    const now = new Date("2024-11-04T05:00:00.000Z");
    const { windowStart, windowEnd } = computeDailyWindow(now);
    // Nov 3 midnight = EDT = 04:00 UTC; Nov 4 midnight = EST = 05:00 UTC
    // Window is 25h (fall-back day is long)
    expect(windowStart).toBe("2024-11-03T04:00:00.000Z"); // midnight EDT Nov 3
    expect(windowEnd).toBe("2024-11-04T05:00:00.000Z");   // midnight EST Nov 4
    const diffHours = (new Date(windowEnd).getTime() - new Date(windowStart).getTime()) / 3600000;
    expect(diffHours).toBe(25);
  });

  it("returns full ISO 8601 timestamps (includes milliseconds, not second-truncated)", () => {
    const now = new Date("2024-01-15T05:00:00.123Z");
    const { windowStart, windowEnd } = computeDailyWindow(now);
    expect(windowStart).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(windowEnd).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("windowEnd is always at or before now", () => {
    const now = new Date("2024-07-15T05:30:00.000Z");
    const { windowEnd } = computeDailyWindow(now);
    expect(new Date(windowEnd).getTime()).toBeLessThanOrEqual(now.getTime());
  });
});

// ── sendDailySummary ──────────────────────────────────────────────────────────

describe("sendDailySummary", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips users with email_reports opted out", async () => {
    // Create user with email_reports = 0
    await env.DB.prepare(
      "INSERT INTO users (id, email, name) VALUES (1, 'opted-out@example.com', 'Opted Out')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO user_settings (user_id, email_reports) VALUES (1, 0)"
    ).run();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const testEnv = { ...env, AWS_SES_ACCESS_KEY: "key", AWS_SES_SECRET_KEY: "secret", AWS_SES_REGION: "us-east-1", REPORT_FROM_EMAIL: "from@example.com" };
    await sendDailySummary(testEnv as typeof env);

    // fetch should never be called (SES email send) for an opted-out user
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips users with no children", async () => {
    await env.DB.prepare(
      "INSERT INTO users (id, email, name) VALUES (1, 'nochildren@example.com', 'No Kids')"
    ).run();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const testEnv = { ...env, AWS_SES_ACCESS_KEY: "key", AWS_SES_SECRET_KEY: "secret", AWS_SES_REGION: "us-east-1", REPORT_FROM_EMAIL: "from@example.com" };
    await sendDailySummary(testEnv as typeof env);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips email when no activity recorded in the window", async () => {
    // User with a child but no activity entries
    await env.DB.prepare(
      "INSERT INTO users (id, email, name) VALUES (1, 'parent@example.com', 'Test Parent')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO children (id, first_name, last_name, birth_date) VALUES (1, 'Baby', 'Test', '2024-01-01')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO user_children (user_id, child_id) VALUES (1, 1)"
    ).run();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const testEnv = { ...env, AWS_SES_ACCESS_KEY: "key", AWS_SES_SECRET_KEY: "secret", AWS_SES_REGION: "us-east-1", REPORT_FROM_EMAIL: "from@example.com" };
    await sendDailySummary(testEnv as typeof env);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends email when activity exists in the window", async () => {
    await env.DB.prepare(
      "INSERT INTO users (id, email, name) VALUES (1, 'parent@example.com', 'Test Parent')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO children (id, first_name, last_name, birth_date) VALUES (1, 'Baby', 'Test', '2024-01-01')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO user_children (user_id, child_id) VALUES (1, 1)"
    ).run();

    // Insert a diaper change within the window (yesterday in ET).
    // computeDailyWindow(now) with a 2024-01-15T05:00Z cron gives window 2024-01-14T05:00Z – 2024-01-15T05:00Z
    await env.DB.prepare(
      "INSERT INTO diaper_changes (child_id, time, type) VALUES (1, '2024-01-14T12:00:00.000Z', 'wet')"
    ).run();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    // Fix 'now' to a known cron fire time so the window is predictable
    vi.setSystemTime(new Date("2024-01-15T05:00:00.000Z"));

    const testEnv = { ...env, AWS_SES_ACCESS_KEY: "key", AWS_SES_SECRET_KEY: "secret", AWS_SES_REGION: "us-east-1", REPORT_FROM_EMAIL: "from@example.com" };
    await sendDailySummary(testEnv as typeof env);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("email.us-east-1.amazonaws.com");
    const bodyStr = init.body as string;
    const body = JSON.parse(bodyStr) as { Destination: { ToAddresses: string[] } };
    expect(body.Destination.ToAddresses).toContain("parent@example.com");
  });

  it("continues to remaining users when one fails", async () => {
    // Two users: first one will cause an error, second should still get an email
    await env.DB.prepare(
      "INSERT INTO users (id, email, name) VALUES (1, 'user1@example.com', 'User One'), (2, 'user2@example.com', 'User Two')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO children (id, first_name, last_name, birth_date) VALUES (1, 'Child1', '', '2024-01-01'), (2, 'Child2', '', '2024-01-01')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO user_children (user_id, child_id) VALUES (1, 1), (2, 2)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO diaper_changes (child_id, time, type) VALUES (1, '2024-01-14T12:00:00.000Z', 'wet'), (2, '2024-01-14T13:00:00.000Z', 'wet')"
    ).run();

    let callCount = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("SES failed");
      return new Response(null, { status: 200 });
    });

    vi.setSystemTime(new Date("2024-01-15T05:00:00.000Z"));

    const testEnv = { ...env, AWS_SES_ACCESS_KEY: "key", AWS_SES_SECRET_KEY: "secret", AWS_SES_REGION: "us-east-1", REPORT_FROM_EMAIL: "from@example.com" };
    // Should not throw even though first user fails
    await expect(sendDailySummary(testEnv as typeof env)).resolves.toBeUndefined();

    // Both users were attempted
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
