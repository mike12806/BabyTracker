import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import {
  deliverDailySummary,
  sendDailySummary,
  type DailySummaryJob,
} from "../src/scheduled/dailySummary.js";
import worker from "../src/index.js";
import { applyMigrations } from "./helpers";

const SES_ENV = {
  AWS_SES_ACCESS_KEY: "key",
  AWS_SES_SECRET_KEY: "secret",
  AWS_SES_REGION: "us-east-1",
  REPORT_FROM_EMAIL: "from@example.com",
};

/** A queue binding that records what it was handed. */
function fakeQueue() {
  const sent: DailySummaryJob[] = [];
  return {
    sent,
    binding: {
      send: vi.fn(async (body: DailySummaryJob) => {
        sent.push(body);
      }),
      sendBatch: vi.fn(),
    },
  };
}

/** One queue message, with the ack/retry calls the consumer is judged on. */
function fakeMessage(body: DailySummaryJob) {
  return {
    id: "msg-1",
    timestamp: new Date(),
    body,
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

async function seedActiveUser() {
  await env.DB.prepare(
    "INSERT INTO users (id, email, name) VALUES (1, 'parent@example.com', 'Test Parent')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO children (id, first_name, last_name, birth_date) VALUES (1, 'Baby', 'Test', '2024-01-01')"
  ).run();
  await env.DB.prepare("INSERT INTO user_children (user_id, child_id) VALUES (1, 1)").run();
  await env.DB.prepare(
    "INSERT INTO diaper_changes (child_id, time, type) VALUES (1, '2024-01-14T12:00:00.000Z', 'wet')"
  ).run();
}

const JOB: DailySummaryJob = {
  userId: 1,
  email: "parent@example.com",
  name: "Test Parent",
  volumeUnit: "ml",
  windowStart: "2024-01-14T05:00:00.000Z",
  windowEnd: "2024-01-15T05:00:00.000Z",
  reportDateLabel: "Sunday, January 14, 2024",
};

describe("daily summary dispatch", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T05:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("enqueues one message per reader instead of sending inline", async () => {
    await seedActiveUser();
    await env.DB.prepare(
      "INSERT INTO users (id, email, name) VALUES (2, 'other@example.com', 'Other Parent')"
    ).run();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const queue = fakeQueue();

    await sendDailySummary({ ...env, ...SES_ENV, EMAIL_QUEUE: queue.binding } as unknown as typeof env);

    expect(queue.sent).toHaveLength(2);
    expect(queue.sent.map((j) => j.email)).toEqual([
      "parent@example.com",
      "other@example.com",
    ]);
    // The cron itself no longer talks to SES — that is the consumer's job, and
    // the reason a failed send can now be retried.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("pins the report window into the message", async () => {
    await seedActiveUser();
    const queue = fakeQueue();

    await sendDailySummary({ ...env, ...SES_ENV, EMAIL_QUEUE: queue.binding } as unknown as typeof env);

    // A retry hours later — past midnight, even — must still send the report
    // for the day it was queued for, not for whatever "yesterday" means then.
    expect(queue.sent[0].windowStart).toBe("2024-01-14T05:00:00.000Z");
    expect(queue.sent[0].windowEnd).toBe("2024-01-15T05:00:00.000Z");
    expect(queue.sent[0].reportDateLabel).toContain("January 14");
  });

  it("carries each reader's own volume unit", async () => {
    await seedActiveUser();
    await env.DB.prepare("INSERT INTO user_settings (user_id, volume_unit) VALUES (1, 'oz')").run();
    const queue = fakeQueue();

    await sendDailySummary({ ...env, ...SES_ENV, EMAIL_QUEUE: queue.binding } as unknown as typeof env);

    expect(queue.sent[0].volumeUnit).toBe("oz");
  });

  it("keeps enqueuing the rest when one message cannot be queued", async () => {
    await seedActiveUser();
    await env.DB.prepare(
      "INSERT INTO users (id, email, name) VALUES (2, 'other@example.com', 'Other Parent')"
    ).run();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(
      sendDailySummary({ ...env, ...SES_ENV, EMAIL_QUEUE: { send } } as unknown as typeof env)
    ).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends inline when no queue is bound", async () => {
    // Local dev and the tests run without a queue. The change is where retries
    // come from, not whether the report goes out at all.
    await seedActiveUser();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await sendDailySummary({ ...env, ...SES_ENV, EMAIL_QUEUE: undefined } as unknown as typeof env);

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("prunes expired idempotency keys on its daily run", async () => {
    await env.DB.prepare(
      "INSERT INTO users (id, email, name) VALUES (1, 'parent@example.com', 'Test Parent')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO client_requests (user_id, table_name, client_request_id, row_id, created_at) VALUES (1, 'feedings', 'ancient', 1, '2020-01-01T00:00:00Z')"
    ).run();

    await sendDailySummary({ ...env, ...SES_ENV, EMAIL_QUEUE: undefined } as unknown as typeof env);

    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM client_requests").first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});

describe("daily summary delivery", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await seedActiveUser();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("acks a message it delivered", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const message = fakeMessage(JOB);

    await worker.queue(
      { messages: [message] } as never,
      { ...env, ...SES_ENV } as unknown as typeof env,
      {} as never
    );

    expect(message.ack).toHaveBeenCalled();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("asks for a message back when the send fails", async () => {
    // The whole point: SES throttles and has bad minutes, and a cron trigger
    // never runs again. This used to be logged and dropped.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Throttled", { status: 429 })
    );
    const message = fakeMessage(JOB);

    await worker.queue(
      { messages: [message] } as never,
      { ...env, ...SES_ENV } as unknown as typeof env,
      {} as never
    );

    expect(message.retry).toHaveBeenCalled();
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("retries only the message that failed", async () => {
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call++;
      return call === 1 ? new Response("boom", { status: 500 }) : new Response(null, { status: 200 });
    });
    const failed = fakeMessage(JOB);
    const succeeded = fakeMessage({ ...JOB, email: "other@example.com" });

    await worker.queue(
      { messages: [failed, succeeded] } as never,
      { ...env, ...SES_ENV } as unknown as typeof env,
      {} as never
    );

    // A batch-level retry would put the report that already went out back in
    // the queue, and a duplicate summary is the failure this exists to avoid.
    expect(failed.retry).toHaveBeenCalled();
    expect(succeeded.ack).toHaveBeenCalled();
    expect(succeeded.retry).not.toHaveBeenCalled();
  });

  it("acks a reader who has nothing to report rather than retrying forever", async () => {
    await env.DB.prepare("DELETE FROM diaper_changes").run();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const message = fakeMessage(JOB);

    await worker.queue(
      { messages: [message] } as never,
      { ...env, ...SES_ENV } as unknown as typeof env,
      {} as never
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalled();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("reports a quiet day as delivered-nothing rather than an error", async () => {
    await env.DB.prepare("DELETE FROM diaper_changes").run();

    const outcome = await deliverDailySummary(
      { ...env, ...SES_ENV } as unknown as typeof env,
      JOB
    );

    expect(outcome).toEqual({ sent: false, reason: "no-activity" });
  });
});
