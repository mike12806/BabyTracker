import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { enqueueReminderChecks, deliverReminder, type ReminderJob } from "../src/scheduled/reminders.js";
import { generateVapidKeys } from "../src/pushSend.js";
import { applyMigrations } from "./helpers";

let VAPID_ENV: { VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string };

beforeAll(async () => {
  const { publicKey, privateKey } = await generateVapidKeys();
  VAPID_ENV = { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: "mailto:test@example.com" };
});

/** A queue binding that records what it was handed. */
function fakeQueue() {
  const sent: ReminderJob[] = [];
  return {
    sent,
    binding: {
      send: vi.fn(async (body: ReminderJob) => {
        sent.push(body);
      }),
      sendBatch: vi.fn(),
    },
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A real (if throwaway) EC keypair + auth secret, in the shape a browser's PushSubscription carries. */
async function fakeSubscriberKeys(): Promise<{ p256dh: string; auth: string }> {
  const keyPair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", keyPair.publicKey)) as ArrayBuffer);
  return { p256dh: bytesToBase64Url(raw), auth: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16))) };
}

async function seedChildWithSubscriber(childId = 1) {
  await env.DB.prepare("INSERT INTO users (id, email, name) VALUES (1, 'parent@example.com', 'Test Parent')").run();
  await env.DB.prepare(
    `INSERT INTO children (id, first_name, last_name, birth_date) VALUES (${childId}, 'Baby', 'Test', '2024-01-01')`
  ).run();
  await env.DB.prepare(`INSERT INTO user_children (user_id, child_id) VALUES (1, ${childId})`).run();
  const { p256dh, auth } = await fakeSubscriberKeys();
  await env.DB.prepare(
    "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, 'https://push.example.com/1', ?, ?)"
  )
    .bind(p256dh, auth)
    .run();
}

describe("enqueueReminderChecks", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("queues a reminder when nothing has been logged for over 2 hours 45 minutes", async () => {
    await seedChildWithSubscriber();
    // Last diaper change 4 hours ago; feeding is recent, so only diaper fires.
    await env.DB.prepare(
      "INSERT INTO diaper_changes (child_id, time, type) VALUES (1, '2024-01-15T08:00:00.000Z', 'wet')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO feedings (child_id, start_time, type) VALUES (1, '2024-01-15T11:30:00.000Z', 'bottle_formula')"
    ).run();
    const queue = fakeQueue();

    await enqueueReminderChecks({ ...env, REMINDER_QUEUE: queue.binding } as unknown as typeof env);

    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0].kind).toBe("diaper");
    expect(queue.sent[0].childName).toBe("Baby Test");

    const state = await env.DB.prepare(
      "SELECT last_notified_at FROM reminder_state WHERE child_id = 1 AND kind = 'diaper'"
    ).first<{ last_notified_at: string }>();
    expect(state?.last_notified_at).toBeTruthy();
  });

  it("queues a reminder when nothing has ever been logged", async () => {
    await seedChildWithSubscriber();
    const queue = fakeQueue();

    await enqueueReminderChecks({ ...env, REMINDER_QUEUE: queue.binding } as unknown as typeof env);

    const kinds = queue.sent.map((j) => j.kind).sort();
    expect(kinds).toEqual(["diaper", "feeding"]);
  });

  it("does not re-queue for the same gap it already notified about", async () => {
    await seedChildWithSubscriber();
    await env.DB.prepare(
      "INSERT INTO diaper_changes (child_id, time, type) VALUES (1, '2024-01-15T08:00:00.000Z', 'wet')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO feedings (child_id, start_time, type) VALUES (1, '2024-01-15T08:00:00.000Z', 'bottle_formula')"
    ).run();

    const first = fakeQueue();
    await enqueueReminderChecks({ ...env, REMINDER_QUEUE: first.binding } as unknown as typeof env);
    expect(first.sent).toHaveLength(2);

    // Same gap, cron runs again 15 minutes later — nothing new to say.
    vi.setSystemTime(new Date("2024-01-15T12:15:00.000Z"));
    const second = fakeQueue();
    await enqueueReminderChecks({ ...env, REMINDER_QUEUE: second.binding } as unknown as typeof env);
    expect(second.sent).toHaveLength(0);
  });

  it("fires again once new activity resets the gap", async () => {
    await seedChildWithSubscriber();
    await env.DB.prepare(
      "INSERT INTO diaper_changes (child_id, time, type) VALUES (1, '2024-01-15T08:00:00.000Z', 'wet')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO feedings (child_id, start_time, type) VALUES (1, '2024-01-15T12:00:00.000Z', 'bottle_formula')"
    ).run();

    const first = fakeQueue();
    await enqueueReminderChecks({ ...env, REMINDER_QUEUE: first.binding } as unknown as typeof env);
    expect(first.sent.map((j) => j.kind)).toEqual(["diaper"]);

    // A new diaper change and feeding are logged, then another 3+ hours pass
    // with nothing new for diapers (but feeding stays inside its own window).
    await env.DB.prepare(
      "INSERT INTO diaper_changes (child_id, time, type) VALUES (1, '2024-01-15T12:05:00.000Z', 'wet')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO feedings (child_id, start_time, type) VALUES (1, '2024-01-15T13:00:00.000Z', 'bottle_formula')"
    ).run();
    vi.setSystemTime(new Date("2024-01-15T15:30:00.000Z"));

    const second = fakeQueue();
    await enqueueReminderChecks({ ...env, REMINDER_QUEUE: second.binding } as unknown as typeof env);
    expect(second.sent.map((j) => j.kind)).toEqual(["diaper"]);
  });

  it("sends inline when no queue is bound", async () => {
    await seedChildWithSubscriber();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));

    await enqueueReminderChecks({ ...env, ...VAPID_ENV, REMINDER_QUEUE: undefined } as unknown as typeof env);

    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe("deliverReminder", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a push to the subscription named in the job", async () => {
    await seedChildWithSubscriber();
    const sub = await env.DB.prepare("SELECT id FROM push_subscriptions").first<{ id: number }>();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));

    await deliverReminder({ ...env, ...VAPID_ENV } as unknown as typeof env, {
      subscriptionId: sub!.id,
      childName: "Baby Test",
      kind: "diaper",
    });

    expect(fetchSpy).toHaveBeenCalledWith("https://push.example.com/1", expect.any(Object));
  });

  it("does nothing when the subscription was removed before delivery", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await deliverReminder({ ...env, ...VAPID_ENV } as unknown as typeof env, {
      subscriptionId: 999,
      childName: "Baby Test",
      kind: "feeding",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
