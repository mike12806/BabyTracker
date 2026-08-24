import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp, applyMigrations, testRequest } from "./helpers";
import { generateVapidKeys } from "../src/pushSend.js";

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

describe("Push subscription API", () => {
  let api: ReturnType<typeof testRequest>;

  beforeEach(async () => {
    const app = createTestApp();
    await applyMigrations(env.DB);
    api = testRequest(app, env.DB);
  });

  it("GET /api/push/vapid-public-key reports unconfigured when no key is set", async () => {
    const res = await api.get("/api/push/vapid-public-key");
    expect(res.status).toBe(501);
  });

  it("POST /api/push/subscribe stores a subscription for the caller", async () => {
    const res = await api.post("/api/push/subscribe", {
      endpoint: "https://push.example.com/abc",
      keys: { p256dh: "p256dh-value", auth: "auth-value" },
    });
    expect(res.status).toBe(201);

    const row = await env.DB.prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
      .bind("https://push.example.com/abc")
      .first<{ p256dh: string; auth: string }>();
    expect(row?.p256dh).toBe("p256dh-value");
    expect(row?.auth).toBe("auth-value");
  });

  it("POST /api/push/subscribe rejects a body missing keys", async () => {
    const res = await api.post("/api/push/subscribe", { endpoint: "https://push.example.com/abc" });
    expect(res.status).toBe(400);
  });

  it("re-subscribing the same endpoint updates rather than duplicates", async () => {
    const body = { endpoint: "https://push.example.com/abc", keys: { p256dh: "one", auth: "one" } };
    await api.post("/api/push/subscribe", body);
    await api.post("/api/push/subscribe", { ...body, keys: { p256dh: "two", auth: "two" } });

    const rows = await env.DB.prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
      .bind(body.endpoint)
      .all<{ p256dh: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].p256dh).toBe("two");
  });

  it("DELETE /api/push/subscribe removes a subscription by endpoint", async () => {
    await api.post("/api/push/subscribe", {
      endpoint: "https://push.example.com/xyz",
      keys: { p256dh: "p", auth: "a" },
    });

    const res = await api.delete(`/api/push/subscribe?endpoint=${encodeURIComponent("https://push.example.com/xyz")}`);
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
      .bind("https://push.example.com/xyz")
      .first();
    expect(row).toBeNull();
  });

  it("DELETE /api/push/subscribe without an endpoint is a 400", async () => {
    const res = await api.delete("/api/push/subscribe");
    expect(res.status).toBe(400);
  });
});

describe("Push subscription confirmation push", () => {
  let app: ReturnType<typeof createTestApp>;
  let vapidEnv: { VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string };

  beforeEach(async () => {
    app = createTestApp();
    await applyMigrations(env.DB);
    const { publicKey, privateKey } = await generateVapidKeys();
    vapidEnv = { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: "mailto:test@example.com" };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a confirmation push right away when subscribing", async () => {
    const { p256dh, auth } = await fakeSubscriberKeys();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));

    const res = await app.request(
      "/api/push/subscribe",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: "https://push.example.com/confirm", keys: { p256dh, auth } }),
      },
      { DB: env.DB, ...vapidEnv }
    );

    expect(res.status).toBe(201);
    expect(fetchSpy).toHaveBeenCalledWith("https://push.example.com/confirm", expect.any(Object));
  });

  it("still succeeds when the confirmation push fails to send", async () => {
    const { p256dh, auth } = await fakeSubscriberKeys();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("push service unreachable"));

    const res = await app.request(
      "/api/push/subscribe",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: "https://push.example.com/confirm-fail", keys: { p256dh, auth } }),
      },
      { DB: env.DB, ...vapidEnv }
    );

    expect(res.status).toBe(201);
    const row = await env.DB.prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
      .bind("https://push.example.com/confirm-fail")
      .first();
    expect(row).toBeTruthy();
  });

  it("queues the confirmation push instead of sending it inline when a queue is bound", async () => {
    const { p256dh, auth } = await fakeSubscriberKeys();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const sent: unknown[] = [];
    const queueBinding = { send: vi.fn(async (body: unknown) => sent.push(body)), sendBatch: vi.fn() };

    const res = await app.request(
      "/api/push/subscribe",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: "https://push.example.com/confirm-queued", keys: { p256dh, auth } }),
      },
      { DB: env.DB, ...vapidEnv, REMINDER_QUEUE: queueBinding }
    );

    expect(res.status).toBe(201);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "confirmation" });
    // No queue bound would fall back to sending inline via fetch — confirms it didn't.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
