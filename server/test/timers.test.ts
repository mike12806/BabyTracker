import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp, applyMigrations, testRequest } from "./helpers";

describe("Timers API", () => {
  let api: ReturnType<typeof testRequest>;
  let childId: number;

  beforeEach(async () => {
    const app = createTestApp();
    await applyMigrations(env.DB);
    api = testRequest(app, env.DB);

    const res = await api.post("/api/children", {
      first_name: "Emma",
      birth_date: "2024-06-15",
    });
    childId = ((await res.json()) as { id: number }).id;
  });

  it("POST /api/timers starts a new timer", async () => {
    const res = await api.post("/api/timers", {
      child_id: childId,
      name: "Feeding",
    });
    expect(res.status).toBe(201);
    const timer = (await res.json()) as Record<string, unknown>;
    expect(timer.name).toBe("Feeding");
    expect(timer.is_active).toBe(1);
    expect(timer.end_time).toBeNull();
  });

  it("GET /api/timers lists timers", async () => {
    await api.post("/api/timers", { child_id: childId, name: "Feeding" });
    await api.post("/api/timers", { child_id: childId, name: "Nap" });

    const res = await api.get("/api/timers");
    expect(res.status).toBe(200);
    const timers = (await res.json()) as unknown[];
    expect(timers).toHaveLength(2);
  });

  it("GET /api/timers?active=true filters active timers", async () => {
    const createRes = await api.post("/api/timers", { child_id: childId, name: "Feeding" });
    const timer = (await createRes.json()) as { id: number };

    // Stop the timer
    await api.put(`/api/timers/${timer.id}/stop`, {});

    // Start another
    await api.post("/api/timers", { child_id: childId, name: "Nap" });

    const res = await api.get("/api/timers?active=true");
    expect(res.status).toBe(200);
    const timers = (await res.json()) as unknown[];
    expect(timers).toHaveLength(1);
  });

  it("PUT /api/timers/:id/stop stops a timer", async () => {
    const createRes = await api.post("/api/timers", {
      child_id: childId,
      name: "Feeding",
    });
    const created = (await createRes.json()) as { id: number };

    const res = await api.put(`/api/timers/${created.id}/stop`, {});
    expect(res.status).toBe(200);
    const timer = (await res.json()) as Record<string, unknown>;
    expect(timer.is_active).toBe(0);
    expect(timer.end_time).not.toBeNull();
  });

  it("DELETE /api/timers/:id deletes a timer", async () => {
    const createRes = await api.post("/api/timers", {
      child_id: childId,
      name: "Feeding",
    });
    const created = (await createRes.json()) as { id: number };

    const res = await api.delete(`/api/timers/${created.id}`);
    expect(res.status).toBe(200);

    const listRes = await api.get("/api/timers");
    const timers = (await listRes.json()) as unknown[];
    expect(timers).toHaveLength(0);
  });

  it("POST /api/timers requires child_id and name", async () => {
    const res = await api.post("/api/timers", { child_id: childId });
    expect(res.status).toBe(400);
  });
});
