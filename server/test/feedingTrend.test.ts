import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import {
  buildTrendWindows,
  checkpointFor,
  compareFeeding,
  deliverFeedingTrendAlert,
  etHour,
  fallbackAlert,
  hourLabel,
  parseAnalysis,
  runFeedingTrendCheck,
  runFeedingTrendCron,
  tidyAlert,
  MAX_ALERT_LENGTH,
  type FeedingTrendJob,
  type FeedingWindowStats,
} from "../src/scheduled/feedingTrend.js";
import { generateVapidKeys } from "../src/pushSend.js";
import { applyMigrations } from "./helpers";

let VAPID_ENV: { VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string };

beforeAll(async () => {
  const { publicKey, privateKey } = await generateVapidKeys();
  VAPID_ENV = {
    VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: privateKey,
    VAPID_SUBJECT: "mailto:test@example.com",
  };
});

/** A queue binding that records what it was handed. */
function fakeQueue() {
  const sent: FeedingTrendJob[] = [];
  return {
    sent,
    binding: {
      send: vi.fn(async (body: FeedingTrendJob) => {
        sent.push(body);
      }),
      sendBatch: vi.fn(),
    },
  };
}

/** An AI binding that answers with whatever JSON the test wants. */
function fakeAi(reply: unknown) {
  return { run: vi.fn(async () => reply) };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function fakeSubscriberKeys(): Promise<{ p256dh: string; auth: string }> {
  const keyPair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", keyPair.publicKey)) as ArrayBuffer);
  return {
    p256dh: bytesToBase64Url(raw),
    auth: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

async function seedChildWithSubscriber() {
  await env.DB.prepare("INSERT INTO users (id, email, name) VALUES (1, 'parent@example.com', 'Test Parent')").run();
  await env.DB.prepare(
    "INSERT INTO children (id, first_name, last_name, birth_date) VALUES (1, 'Mikey', 'Test', '2024-06-01')",
  ).run();
  await env.DB.prepare("INSERT INTO user_children (user_id, child_id) VALUES (1, 1)").run();
  const { p256dh, auth } = await fakeSubscriberKeys();
  await env.DB.prepare(
    "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, 'https://push.example.com/1', ?, ?)",
  )
    .bind(p256dh, auth)
    .run();
}

/** Log `count` feeds of `oz` each, spread through the morning of an ET day.
 *  Times are given in UTC; 12:00–14:00 UTC is 8–10am EDT, safely inside the
 *  window a 11am ET checkpoint looks at. */
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

/** The previous seven ET days before 2024-07-15, which is what
 *  `buildTrendWindows` walks back over from a 2024-07-15 checkpoint. */
const BASELINE_DATES = [
  "2024-07-14",
  "2024-07-13",
  "2024-07-12",
  "2024-07-11",
  "2024-07-10",
  "2024-07-09",
  "2024-07-08",
];

/** 11am EDT on 2024-07-15. */
const ELEVEN_AM_EDT = new Date("2024-07-15T15:00:00.000Z");

function stats(feeds: number, volumeOz: number | null): FeedingWindowStats {
  return { feeds, volumeOz, lastFeedAt: feeds > 0 ? "2024-07-15T13:00:00.000Z" : null };
}

describe("etHour / checkpointFor", () => {
  it("reads the Eastern clock hour, not the UTC one", () => {
    expect(etHour(new Date("2024-07-15T15:00:00.000Z"))).toBe(11); // EDT, UTC-4
    expect(etHour(new Date("2024-01-15T16:00:00.000Z"))).toBe(11); // EST, UTC-5
  });

  it("accepts exactly the three checkpoints, on both sides of daylight saving", () => {
    // Summer (EDT): 15:00, 20:00 and 23:00 UTC are the checkpoints.
    expect(checkpointFor(new Date("2024-07-15T15:00:00.000Z"))).toBe(11);
    expect(checkpointFor(new Date("2024-07-15T20:00:00.000Z"))).toBe(16);
    expect(checkpointFor(new Date("2024-07-15T23:00:00.000Z"))).toBe(19);
    // Winter (EST): 16:00, 21:00 and 00:00 UTC are.
    expect(checkpointFor(new Date("2024-01-15T16:00:00.000Z"))).toBe(11);
    expect(checkpointFor(new Date("2024-01-15T21:00:00.000Z"))).toBe(16);
    expect(checkpointFor(new Date("2024-01-16T00:00:00.000Z"))).toBe(19);
  });

  it("rejects the three firings that land on the wrong local hour", () => {
    // The same six UTC hours, on the other side of the year.
    expect(checkpointFor(new Date("2024-07-15T16:00:00.000Z"))).toBeNull(); // noon EDT
    expect(checkpointFor(new Date("2024-07-15T21:00:00.000Z"))).toBeNull(); // 5pm EDT
    expect(checkpointFor(new Date("2024-07-16T00:00:00.000Z"))).toBeNull(); // 8pm EDT
    expect(checkpointFor(new Date("2024-01-15T15:00:00.000Z"))).toBeNull(); // 10am EST
    expect(checkpointFor(new Date("2024-01-15T20:00:00.000Z"))).toBeNull(); // 3pm EST
    expect(checkpointFor(new Date("2024-01-15T23:00:00.000Z"))).toBeNull(); // 6pm EST
  });

  it("says the checkpoint the way the alert does", () => {
    expect(hourLabel(11)).toBe("11am");
    expect(hourLabel(16)).toBe("4pm");
    expect(hourLabel(19)).toBe("7pm");
  });
});

describe("buildTrendWindows", () => {
  it("runs today from ET midnight to now", () => {
    const windows = buildTrendWindows(ELEVEN_AM_EDT);
    expect(windows.checkDate).toBe("2024-07-15");
    expect(windows.todayStart).toBe("2024-07-15T04:00:00.000Z"); // midnight EDT
    expect(windows.todayEnd).toBe("2024-07-15T15:00:00.000Z");
  });

  it("gives every baseline day the same elapsed span, on consecutive ET dates", () => {
    const windows = buildTrendWindows(ELEVEN_AM_EDT);
    expect(windows.baseline).toHaveLength(7);
    expect(windows.baseline.map((w) => w.start.slice(0, 10))).toEqual(BASELINE_DATES);

    const elapsed = new Date(windows.todayEnd).getTime() - new Date(windows.todayStart).getTime();
    for (const w of windows.baseline) {
      expect(new Date(w.end).getTime() - new Date(w.start).getTime()).toBe(elapsed);
    }
  });

  it("keeps ET days lined up across a daylight saving change", () => {
    // 11am EST on 2024-11-05, two days after the fall-back — the baseline
    // therefore straddles the 25-hour day of 2024-11-03.
    const windows = buildTrendWindows(new Date("2024-11-05T16:00:00.000Z"));
    expect(windows.checkDate).toBe("2024-11-05");
    expect(windows.baseline.map((w) => w.start.slice(0, 10))).toEqual([
      "2024-11-04",
      "2024-11-03",
      "2024-11-02",
      "2024-11-01",
      "2024-10-31",
      "2024-10-30",
      "2024-10-29",
    ]);
    // Every window is still exactly as long as today's, so a 25-hour day does
    // not read as a feeding trend.
    const elapsed = new Date(windows.todayEnd).getTime() - new Date(windows.todayStart).getTime();
    for (const w of windows.baseline) {
      expect(new Date(w.end).getTime() - new Date(w.start).getTime()).toBe(elapsed);
    }
  });
});

describe("compareFeeding", () => {
  const week = (feeds: number, oz: number | null) => Array.from({ length: 7 }, () => stats(feeds, oz));

  it("flags a shortfall in feed count", () => {
    const result = compareFeeding(stats(2, 8), week(5, 20));
    expect(result.below).toBe(true);
    expect(result.baseline.feeds).toBe(5);
    expect(result.feedsChange).toBeCloseTo(-0.6);
  });

  it("flags a shortfall in volume even when the feed count holds up", () => {
    const result = compareFeeding(stats(5, 10), week(5, 20));
    expect(result.below).toBe(true);
    expect(result.feedsChange).toBe(0);
    expect(result.volumeChange).toBeCloseTo(-0.5);
  });

  it("treats a small difference as noise", () => {
    const result = compareFeeding(stats(5, 19), week(5, 20));
    expect(result.below).toBe(false);
    expect(result.reason).toBe("on-track");
  });

  it("never flags a day that is ahead", () => {
    expect(compareFeeding(stats(8, 30), week(5, 20)).below).toBe(false);
  });

  it("holds off until there are enough days to call it a week", () => {
    const twoDays = [stats(5, 20), stats(5, 20), stats(0, null), stats(0, null), stats(0, null), stats(0, null), stats(0, null)];
    const result = compareFeeding(stats(0, null), twoDays);
    expect(result.below).toBe(false);
    expect(result.reason).toBe("no-baseline");
    expect(result.baseline.days).toBe(2);
  });

  it("ignores volume when this household doesn't log amounts", () => {
    // Breastfeeding: feeds are logged, amounts are not. Volume can't be
    // compared, but the feed count still can.
    const result = compareFeeding(stats(2, null), week(6, null));
    expect(result.volumeChange).toBeNull();
    expect(result.below).toBe(true);
  });

  it("averages over the days with data, not over all seven", () => {
    const threeDays = [stats(6, 24), stats(6, 24), stats(6, 24), stats(0, null), stats(0, null), stats(0, null), stats(0, null)];
    const result = compareFeeding(stats(2, 8), threeDays);
    expect(result.baseline.days).toBe(3);
    expect(result.baseline.feeds).toBe(6);
    expect(result.below).toBe(true);
  });
});

describe("parseAnalysis", () => {
  it("reads a bare JSON object", () => {
    expect(parseAnalysis('{"alert": true, "message": "Mikey has had 2 feeds by 11am, against 5 usually."}')).toEqual({
      alert: true,
      message: "Mikey has had 2 feeds by 11am, against 5 usually.",
    });
  });

  it("reads one wrapped in a code fence and chatter", () => {
    const raw = 'Sure!\n```json\n{"alert": false, "message": ""}\n```\nHope that helps.';
    expect(parseAnalysis(raw)).toEqual({ alert: false, message: "" });
  });

  it("accepts a no-alert answer with no message at all", () => {
    expect(parseAnalysis('{"alert": false}')).toEqual({ alert: false, message: "" });
  });

  it("rejects anything that isn't the shape asked for", () => {
    expect(parseAnalysis("no idea, sorry")).toBeNull();
    expect(parseAnalysis('{"alert": "yes", "message": "..."}')).toBeNull();
    // An "alert" with no usable sentence is not an answer.
    expect(parseAnalysis('{"alert": true, "message": "too short"}')).toBeNull();
  });
});

describe("fallbackAlert / tidyAlert", () => {
  it("says the same true figures the model was given", () => {
    const comparison = compareFeeding(stats(2, 8), Array.from({ length: 7 }, () => stats(5, 20)));
    const body = fallbackAlert("Mikey", "11am", comparison);
    expect(body).toContain("Mikey");
    expect(body).toContain("2 feeds");
    expect(body).toContain("8 oz");
    expect(body).toContain("11am");
    expect(body.length).toBeLessThanOrEqual(MAX_ALERT_LENGTH);
  });

  it("clips a model that ignored the length brief", () => {
    const long = `${"Mikey has had two feeds so far today. ".repeat(20)}`;
    expect(tidyAlert(long)!.length).toBeLessThanOrEqual(MAX_ALERT_LENGTH);
  });
});

describe("runFeedingTrendCheck", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await seedChildWithSubscriber();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Six feeds of 4oz on each of the previous seven days; two today. */
  async function seedShortfall() {
    for (const day of BASELINE_DATES) await logFeeds(day, 6, 4);
    await logFeeds("2024-07-15", 2, 4);
  }

  it("queues one push per subscribed device when the model agrees", async () => {
    await seedShortfall();
    const queue = fakeQueue();
    const AI = fakeAi({ response: '{"alert": true, "message": "Mikey has had 2 feeds by 11am, against 6 on an average day last week."}' });

    const checks = await runFeedingTrendCheck(
      { ...env, AI, FEEDING_TREND_QUEUE: queue.binding } as unknown as typeof env,
      { now: ELEVEN_AM_EDT, send: true },
    );

    expect(checks).toHaveLength(1);
    expect(checks[0].alerted).toBe(true);
    expect(checks[0].source).toBe("ai");
    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0].body).toContain("Mikey");

    const row = await env.DB.prepare("SELECT * FROM feeding_trend_checks").first<{
      checkpoint: number;
      check_date: string;
      alerted: number;
      source: string;
      body: string;
    }>();
    expect(row).toMatchObject({ checkpoint: 11, check_date: "2024-07-15", alerted: 1, source: "ai" });
  });

  it("sends nothing when today is on track", async () => {
    for (const day of BASELINE_DATES) await logFeeds(day, 6, 4);
    await logFeeds("2024-07-15", 6, 4);
    const queue = fakeQueue();
    const AI = fakeAi({ response: '{"alert": true, "message": "should never be asked for"}' });

    const checks = await runFeedingTrendCheck(
      { ...env, AI, FEEDING_TREND_QUEUE: queue.binding } as unknown as typeof env,
      { now: ELEVEN_AM_EDT, send: true },
    );

    expect(checks[0].skipped).toBe("on-track");
    expect(queue.sent).toHaveLength(0);
    // The model is never consulted about a day that isn't behind — it can only
    // veto an alert, never invent one.
    expect(AI.run).not.toHaveBeenCalled();
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM feeding_trend_checks").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("lets the model veto an alert the figures found", async () => {
    await seedShortfall();
    const queue = fakeQueue();
    const AI = fakeAi({ response: '{"alert": false, "message": ""}' });

    const checks = await runFeedingTrendCheck(
      { ...env, AI, FEEDING_TREND_QUEUE: queue.binding } as unknown as typeof env,
      { now: ELEVEN_AM_EDT, send: true },
    );

    expect(checks[0].skipped).toBe("model-declined");
    expect(checks[0].alerted).toBe(false);
    expect(queue.sent).toHaveLength(0);
    // Recorded anyway, so a model that vetoes everything is visible.
    const row = await env.DB.prepare("SELECT alerted FROM feeding_trend_checks").first<{ alerted: number }>();
    expect(row?.alerted).toBe(0);
  });

  it("alerts on the template sentence when there is no AI binding", async () => {
    await seedShortfall();
    const queue = fakeQueue();

    const checks = await runFeedingTrendCheck(
      { ...env, AI: undefined, FEEDING_TREND_QUEUE: queue.binding } as unknown as typeof env,
      { now: ELEVEN_AM_EDT, send: true },
    );

    expect(checks[0].alerted).toBe(true);
    expect(checks[0].source).toBe("fallback");
    expect(queue.sent[0].body).toContain("2 feeds");
  });

  it("alerts on the template sentence when the model answers unusably", async () => {
    await seedShortfall();
    const queue = fakeQueue();
    const AI = fakeAi({ response: "I'm not sure what you want from me." });

    const checks = await runFeedingTrendCheck(
      { ...env, AI, FEEDING_TREND_QUEUE: queue.binding } as unknown as typeof env,
      { now: ELEVEN_AM_EDT, send: true },
    );

    // Both models in the chain are tried before falling through.
    expect(AI.run).toHaveBeenCalledTimes(2);
    expect(checks[0].alerted).toBe(true);
    expect(checks[0].source).toBe("fallback");
    expect(checks[0].reason).toContain("unusable reply");
    expect(queue.sent).toHaveLength(1);
  });

  it("does not alert twice for the same checkpoint", async () => {
    await seedShortfall();
    const AI = fakeAi({ response: '{"alert": true, "message": "Mikey has had 2 feeds by 11am, against 6 on an average day."}' });

    const first = fakeQueue();
    await runFeedingTrendCheck({ ...env, AI, FEEDING_TREND_QUEUE: first.binding } as unknown as typeof env, {
      now: ELEVEN_AM_EDT,
      send: true,
    });
    expect(first.sent).toHaveLength(1);

    // The same checkpoint again — a cron retry, or the EST firing colliding
    // with the EDT one around a clock change.
    const second = fakeQueue();
    const checks = await runFeedingTrendCheck(
      { ...env, AI, FEEDING_TREND_QUEUE: second.binding } as unknown as typeof env,
      { now: new Date("2024-07-15T15:02:00.000Z"), send: true },
    );
    expect(second.sent).toHaveLength(0);
    expect(checks[0].skipped).toBe("already-checked");
  });

  it("alerts again at the next checkpoint of the same day", async () => {
    await seedShortfall();
    const AI = fakeAi({ response: '{"alert": true, "message": "Mikey has had 2 feeds by now, against 6 on an average day."}' });

    const morning = fakeQueue();
    await runFeedingTrendCheck({ ...env, AI, FEEDING_TREND_QUEUE: morning.binding } as unknown as typeof env, {
      now: ELEVEN_AM_EDT,
      send: true,
    });

    const afternoon = fakeQueue();
    await runFeedingTrendCheck({ ...env, AI, FEEDING_TREND_QUEUE: afternoon.binding } as unknown as typeof env, {
      now: new Date("2024-07-15T20:00:00.000Z"), // 4pm EDT
      send: true,
    });

    expect(afternoon.sent).toHaveLength(1);
    const rows = await env.DB.prepare("SELECT checkpoint FROM feeding_trend_checks ORDER BY checkpoint").all<{
      checkpoint: number;
    }>();
    expect(rows.results.map((r) => r.checkpoint)).toEqual([11, 16]);
  });

  it("previews without notifying anyone or spending the checkpoint", async () => {
    await seedShortfall();
    const queue = fakeQueue();
    const AI = fakeAi({ response: '{"alert": true, "message": "Mikey has had 2 feeds by 11am, against 6 on an average day."}' });

    const checks = await runFeedingTrendCheck(
      { ...env, AI, FEEDING_TREND_QUEUE: queue.binding } as unknown as typeof env,
      { now: ELEVEN_AM_EDT, send: false },
    );

    expect(checks[0].skipped).toBe("preview");
    expect(checks[0].body).toContain("Mikey");
    expect(queue.sent).toHaveLength(0);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM feeding_trend_checks").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("sends inline when no queue is bound", async () => {
    await seedShortfall();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));

    await runFeedingTrendCheck(
      { ...env, ...VAPID_ENV, AI: undefined, FEEDING_TREND_QUEUE: undefined } as unknown as typeof env,
      { now: ELEVEN_AM_EDT, send: true },
    );

    expect(fetchSpy).toHaveBeenCalledWith("https://push.example.com/1", expect.any(Object));
  });

  it("records the check but reports no subscribers when nobody is subscribed", async () => {
    await seedShortfall();
    await env.DB.prepare("DELETE FROM push_subscriptions").run();
    const queue = fakeQueue();

    const checks = await runFeedingTrendCheck(
      { ...env, AI: undefined, FEEDING_TREND_QUEUE: queue.binding } as unknown as typeof env,
      { now: ELEVEN_AM_EDT, send: true },
    );

    expect(checks[0].skipped).toBe("no-subscribers");
    expect(checks[0].alerted).toBe(false);
  });
});

describe("runFeedingTrendCron", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await seedChildWithSubscriber();
    for (const day of BASELINE_DATES) await logFeeds(day, 6, 4);
    await logFeeds("2024-07-15", 2, 4);
  });

  it("checks at a checkpoint hour", async () => {
    const queue = fakeQueue();
    const checks = await runFeedingTrendCron(
      { ...env, AI: undefined, FEEDING_TREND_QUEUE: queue.binding } as unknown as typeof env,
      ELEVEN_AM_EDT,
    );
    expect(checks).toHaveLength(1);
    expect(queue.sent).toHaveLength(1);
  });

  it("does nothing at the three firings that land on the wrong local hour", async () => {
    const queue = fakeQueue();
    const checks = await runFeedingTrendCron(
      { ...env, AI: undefined, FEEDING_TREND_QUEUE: queue.binding } as unknown as typeof env,
      new Date("2024-07-15T16:00:00.000Z"), // noon EDT — the EST firing of the 11am check
    );
    expect(checks).toEqual([]);
    expect(queue.sent).toHaveLength(0);
  });
});

describe("deliverFeedingTrendAlert", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await seedChildWithSubscriber();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pushes the body it was handed to the subscription named in the job", async () => {
    const sub = await env.DB.prepare("SELECT id FROM push_subscriptions").first<{ id: number }>();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));

    await deliverFeedingTrendAlert({ ...env, ...VAPID_ENV } as unknown as typeof env, {
      subscriptionId: sub!.id,
      childName: "Mikey",
      body: "Mikey has had 2 feeds by 11am, against 6 on an average day last week.",
    });

    expect(fetchSpy).toHaveBeenCalledWith("https://push.example.com/1", expect.any(Object));
  });

  it("does nothing when the subscription was removed before delivery", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await deliverFeedingTrendAlert({ ...env, ...VAPID_ENV } as unknown as typeof env, {
      subscriptionId: 999,
      childName: "Mikey",
      body: "anything",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
