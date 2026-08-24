import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp, applyMigrations, testRequest } from "./helpers";

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
