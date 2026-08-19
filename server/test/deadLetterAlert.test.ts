import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import wranglerConfig from "../wrangler.toml?raw";
import worker from "../src/index.js";
import {
  alertDeadLetteredSummary,
  DAILY_SUMMARY_DLQ,
  DAILY_SUMMARY_QUEUE,
  type DailySummaryJob,
} from "../src/scheduled/dailySummary.js";
import { applyMigrations } from "./helpers";

const SES_ENV = {
  AWS_SES_ACCESS_KEY: "key",
  AWS_SES_SECRET_KEY: "secret",
  AWS_SES_REGION: "us-east-1",
  REPORT_FROM_EMAIL: "from@example.com",
};

const JOB: DailySummaryJob = {
  userId: 1,
  email: "parent@example.com",
  name: "Test Parent",
  volumeUnit: "ml",
  windowStart: "2024-01-14T05:00:00.000Z",
  windowEnd: "2024-01-15T05:00:00.000Z",
  reportDateLabel: "Sunday, January 14, 2024",
};

function fakeMessage(body: DailySummaryJob, attempts = 4) {
  return {
    id: "msg-1",
    timestamp: new Date(),
    body,
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

/** Run the Worker's queue handler as the named queue's consumer would. */
function runQueue(
  queue: string,
  messages: ReturnType<typeof fakeMessage>[],
  overrides: Record<string, unknown> = {}
) {
  return worker.queue(
    { queue, messages } as never,
    { ...env, ...SES_ENV, ...overrides } as unknown as typeof env,
    {} as never
  );
}

/** The SES call body, for asserting on what was actually sent. */
function sesPayloads(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.map(([, init]) =>
    JSON.parse((init as RequestInit).body as string) as {
      Destination: { ToAddresses: string[] };
      Content: { Simple: { Subject: { Data: string }; Body: { Html: { Data: string } } } };
    }
  );
}

describe("queue names", () => {
  it("match the ones wrangler.toml declares", () => {
    // The Worker has one queue() handler for both consumers and tells the
    // batches apart by name, so a rename in the config that missed the code
    // would route dead letters into the delivery path — and try to send the
    // failed report again, to the reader, forever.
    expect(wranglerConfig).toContain(`queue = "${DAILY_SUMMARY_QUEUE}"`);
    expect(wranglerConfig).toContain(`queue = "${DAILY_SUMMARY_DLQ}"`);
    expect(wranglerConfig).toContain(`dead_letter_queue = "${DAILY_SUMMARY_DLQ}"`);
  });
});

describe("dead-lettered summaries", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emails the operator when a report is given up on", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const message = fakeMessage(JOB);

    await runQueue(DAILY_SUMMARY_DLQ, [message], { ALERT_EMAIL: "ops@example.com" });

    const [payload] = sesPayloads(fetchSpy);
    expect(payload.Destination.ToAddresses).toEqual(["ops@example.com"]);
    expect(payload.Content.Simple.Subject.Data).toContain("not delivered");
    // Enough to know whose report was lost and for which day, without
    // going and reading the logs first.
    expect(payload.Content.Simple.Body.Html.Data).toContain("parent@example.com");
    expect(payload.Content.Simple.Body.Html.Data).toContain("January 14, 2024");
    expect(message.ack).toHaveBeenCalled();
  });

  it("falls back to the sender address when no alert address is set", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await runQueue(DAILY_SUMMARY_DLQ, [fakeMessage(JOB)]);

    expect(sesPayloads(fetchSpy)[0].Destination.ToAddresses).toEqual(["from@example.com"]);
  });

  it("does not send the failed report to the reader again", async () => {
    // The message body is the reader's job. Handing it to the delivery path
    // would retry a send that has already been given up on, at the reader.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await runQueue(DAILY_SUMMARY_DLQ, [fakeMessage(JOB)], { ALERT_EMAIL: "ops@example.com" });

    for (const payload of sesPayloads(fetchSpy)) {
      expect(payload.Destination.ToAddresses).not.toContain("parent@example.com");
    }
  });

  it("says how many attempts were made", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await runQueue(DAILY_SUMMARY_DLQ, [fakeMessage(JOB, 4)], { ALERT_EMAIL: "ops@example.com" });

    expect(sesPayloads(fetchSpy)[0].Content.Simple.Body.Html.Data).toContain("4 attempts");
  });

  it("retries when the alert itself cannot be sent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Throttled", { status: 429 }));
    const message = fakeMessage(JOB);

    await runQueue(DAILY_SUMMARY_DLQ, [message], { ALERT_EMAIL: "ops@example.com" });

    expect(message.retry).toHaveBeenCalled();
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("acks without sending when there is nowhere to report to", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const message = fakeMessage(JOB);

    await worker.queue(
      { queue: DAILY_SUMMARY_DLQ, messages: [message] } as never,
      {
        ...env,
        AWS_SES_ACCESS_KEY: "key",
        AWS_SES_SECRET_KEY: "secret",
        AWS_SES_REGION: "us-east-1",
      } as unknown as typeof env,
      {} as never
    );

    // No address configured is a misconfiguration, not a transient failure —
    // retrying it just burns the attempts and discards the message anyway.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalled();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("still delivers normally on the main queue", async () => {
    // The routing has to work in both directions.
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

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const message = fakeMessage(JOB, 1);

    await runQueue(DAILY_SUMMARY_QUEUE, [message]);

    expect(sesPayloads(fetchSpy)[0].Destination.ToAddresses).toEqual(["parent@example.com"]);
    expect(message.ack).toHaveBeenCalled();
  });

  it("escapes the reader's name rather than pasting it into the alert", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await alertDeadLetteredSummary(
      { ...env, ...SES_ENV, ALERT_EMAIL: "ops@example.com" } as unknown as typeof env,
      { ...JOB, name: '<script>alert("x")</script>' },
      4
    );

    const html = sesPayloads(fetchSpy)[0].Content.Simple.Body.Html.Data;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
